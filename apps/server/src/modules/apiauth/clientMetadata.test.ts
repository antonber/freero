// OAuth clients identified by a client metadata document (#81): an https URL as client_id, its
// metadata fetched from there. What must hold: the document speaks only for its own URL and only
// for the redirects it lists, the consent screen shows the host it came from, a private address is
// never fetched, and a refused document is never remembered.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { isBlockedAddress, type Resolver } from '../unfurl/index';
import { authenticate, registerProtectedResource } from './credentials';
import { httpsMetadataFetcher, setMetadataFetcher, type MetadataResponse } from './clientMetadata';
import { checkAuthorizeRequest, consentInfo, decide, tokenRequest } from './oauth';

const AT = { issuer: 'http://freero.test', userId: null };
const DOC_URL = 'https://app.example/oauth/client.json';
let alice: { id: string };

beforeAll(async () => {
  await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  registerProtectedResource('/api/v1', 'Freero REST API');
  alice = await createUser({ name: 'Alice', email: 'alice@cimd.test.freero.app', password: 'password-123' });
});
afterEach(() => setMetadataFetcher(null));
afterAll(() => closeTestDb());

const json = (doc: unknown, headers: Partial<MetadataResponse> = {}): MetadataResponse => ({
  status: 200,
  contentType: 'application/json',
  cacheControl: '',
  body: Buffer.from(JSON.stringify(doc)),
  ...headers,
});
/** Serves `docs[url]` and counts how often each URL was fetched. */
function serve(docs: Record<string, () => MetadataResponse>) {
  const fetched: string[] = [];
  setMetadataFetcher(async (url) => {
    fetched.push(url.href);
    const d = docs[url.href];
    if (!d) return { status: 404, contentType: 'text/plain', cacheControl: '', body: Buffer.from('no') };
    return d();
  });
  return fetched;
}
const pkce = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};
const ask = (clientId: string, redirectUri: string, challenge = 'c'.repeat(43)) =>
  checkAuthorizeRequest({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri, scope: 'boards:read', code_challenge: challenge, code_challenge_method: 'S256' }, AT);

it('an app identified by its metadata document connects end to end: the consent names the host it came from, the URL redeems the code, and the document is fetched once while fresh', async () => {
  const fetched = serve({
    [DOC_URL]: () =>
      json(
        {
          client_id: DOC_URL,
          client_name: 'Example Assistant',
          client_uri: 'https://bank.example', // someone else's site: not shown as the app's
          redirect_uris: ['https://app.example/callback', 'http://127.0.0.1/callback'],
          token_endpoint_auth_method: 'none',
        },
        { cacheControl: 'max-age=600' },
      ),
  });
  const { verifier, challenge } = pkce();
  const checked = await ask(DOC_URL, 'http://127.0.0.1:53111/callback', challenge); // a loopback redirect, any port
  if (!('ok' in checked)) throw new Error(JSON.stringify(checked));
  const consent = consentInfo(checked.ok);
  expect(consent.client).toMatchObject({ clientId: DOC_URL, name: 'Example Assistant', registration: 'metadata', host: 'app.example', website: null });
  expect(consent.localRedirect).toBe(true);
  // The decision re-checks the request: the stored copy answers, nothing is fetched again.
  const again = await ask(DOC_URL, 'http://127.0.0.1:53111/callback', challenge);
  if (!('ok' in again)) throw new Error(JSON.stringify(again));
  const code = new URL(await decide(alice.id, 'password', again.ok, true)).searchParams.get('code')!;
  const tokens = await tokenRequest({ headers: {} } as Request, { grant_type: 'authorization_code', client_id: DOC_URL, code, code_verifier: verifier });
  const cred = await authenticate({ headers: { authorization: `Bearer ${tokens.access_token}` } } as unknown as Request, '/api/v1');
  expect(cred.clientId).toBe(DOC_URL);
  expect(fetched).toEqual([DOC_URL]);
});

it('a document that speaks for another client_id, asks for a shared secret, or is used with a redirect it doesn’t list gets no consent screen and no code — and a refusal is never remembered', async () => {
  const url = 'https://other.example/client.json';
  let doc: Record<string, unknown> = { client_id: 'https://victim.example/client.json', client_name: 'Victim', redirect_uris: ['https://other.example/cb'] };
  const fetched = serve({ [url]: () => json(doc) });
  const lying = await ask(url, 'https://other.example/cb');
  expect('fatal' in lying && lying.fatal).toMatch(/different client_id/);

  doc = { ...doc, client_id: url };
  // Fixed at the source: fetched again (the refusal wasn't cached) and accepted…
  expect('ok' in (await ask(url, 'https://other.example/cb'))).toBe(true);
  // …but only for the redirects it lists: never redirected to an unlisted one, not even with an error.
  const elsewhere = await ask(url, 'https://attacker.example/cb');
  expect(elsewhere).toEqual({ fatal: expect.stringMatching(/redirect_uri/) });
  expect(fetched).toEqual([url, url]);

  // A document asking for a shared secret is refused too.
  doc = { ...doc, client_id: 'https://third.example/client.json', token_endpoint_auth_method: 'client_secret_basic' };
  serve({ 'https://third.example/client.json': () => json(doc) });
  expect(await ask('https://third.example/client.json', 'https://other.example/cb')).toEqual({ fatal: expect.stringMatching(/shared-secret/) });
});

it('a client_id URL that names or resolves to a private address is never fetched (SSRF)', async () => {
  // The production fetcher, with a DNS answer pointing into the private network.
  const resolved: string[] = [];
  const toPrivate: Resolver = (hostname, _o, cb) => {
    resolved.push(hostname);
    cb(null, [{ address: '10.0.0.7', family: 4 }]);
  };
  setMetadataFetcher(httpsMetadataFetcher({ resolve: toPrivate, isBlocked: isBlockedAddress, port: 443 }));
  const viaDns = await ask('https://internal.example/client.json', 'https://internal.example/cb');
  expect(viaDns).toEqual({ fatal: expect.stringMatching(/private network/) });
  expect(resolved).toEqual(['internal.example']);
  // Addresses written into the URL itself, plain http and odd ports are refused before any lookup.
  for (const id of ['https://10.0.0.7/client.json', 'https://[::1]/client.json', 'https://localhost/client.json', 'http://app.example/client.json', 'https://app.example:8443/client.json'])
    expect(await ask(id, 'https://app.example/cb'), id).toHaveProperty('fatal');
  expect(resolved).toEqual(['internal.example']);
});
