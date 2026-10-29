// API credentials against a real (in-memory) database: what makes a token stop working, the OAuth
// code and refresh rules, and a team's API switch.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { MCP_SCOPES } from '@freero/shared';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, endSessionsOf, onSignInRestriction } from '../auth/index';
import { createBoard } from '../boards/index';
import { proposeSuggestions, readBoardView, SUGGESTION_WITHDRAWALS_CONSUMER, suggestionWithdrawalsConsumer } from '../realtime/index';
import { createTeamWorkspace, ensurePersonalWorkspace } from '../workspaces/index';
import { authenticate, createPersonalToken, registerProtectedResource, revokePersonalToken, setTokenPaused, useInWorkspace } from './credentials';
import initApiAuth from './init';
import { checkAuthorizeRequest, cleanRedirectUri, decide, redirectMatches, registerDynamicClient, revokeApp, tokenRequest } from './oauth';
import { setCredentialBlocked, setWorkspaceApiAccess } from './workspacePolicy';

const R = '/api/v1';
let alice: { id: string };

beforeAll(async () => {
  const config = await openTestDb({ PUBLIC_URL: 'http://freero.test' });
  registerProtectedResource(R, 'Freero REST API');
  registerProtectedResource('/mcp', 'Freero MCP server', { scopes: MCP_SCOPES, optInScopes: ['boards:write', 'comments:write'] });
  initApiAuth({ config, onShutdown: () => undefined });
  alice = await createUser({ name: 'Alice', email: 'alice@apiauth.test.freero.app', password: 'password-123' });
});
afterAll(() => closeTestDb());

const bearer = (secret: string) => ({ headers: { authorization: `Bearer ${secret}` } }) as unknown as Request;
/** null when the credential is accepted, else how it was refused. */
const refusal = (secret: string) =>
  authenticate(bearer(secret), R).then(
    () => null,
    (e: { status: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const token = (userId: string, via = 'password', scopes = ['boards:read']) => createPersonalToken(userId, via, { name: 'ci', scopes: scopes as never, expiresInDays: 30 });

async function authorizeApp(userId: string, via = 'password', clientId?: string) {
  const reg = clientId ? { client_id: clientId } : ((await registerDynamicClient({ client_name: 'Agent', redirect_uris: ['http://127.0.0.1:7777/cb'] })) as { client_id: string });
  const verifier = randomBytes(32).toString('base64url');
  const params = {
    response_type: 'code',
    client_id: reg.client_id,
    redirect_uri: 'http://127.0.0.1:41000/cb',
    scope: 'boards:read',
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
  };
  const checked = await checkAuthorizeRequest(params);
  if (!('ok' in checked)) throw new Error(JSON.stringify(checked));
  const code = new URL(await decide(userId, via, checked.ok, true)).searchParams.get('code')!;
  return { clientId: reg.client_id, code, verifier, redirectUri: params.redirect_uri };
}
const exchange = (body: Record<string, unknown>) => tokenRequest({ headers: {} } as Request, body);

it('a paused or revoked token is refused on its very next request, and a resumed one works again', async () => {
  const { token: t, secret } = await token(alice.id);
  expect(await refusal(secret)).toBeNull();
  await setTokenPaused(alice.id, t.id, true);
  expect(await refusal(secret)).toEqual({ status: 401, code: 'invalid_token' });
  await setTokenPaused(alice.id, t.id, false);
  expect(await refusal(secret)).toBeNull();
  await revokePersonalToken(alice.id, t.id);
  expect(await refusal(secret)).toEqual({ status: 401, code: 'invalid_token' });
});

it('a token made before the organization required SSO stops working; one made from an SSO session keeps working', async () => {
  const before = await token(alice.id, 'password');
  const viaSso = await token(alice.id, 'sso:ws1');
  const app = await authorizeApp(alice.id, 'password');
  const appTokens = await exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: app.verifier });
  const off = onSignInRestriction((a) => (a.userId === alice.id && a.method !== 'sso:ws1' ? { message: 'Your organization requires SSO.', ssoUrl: '/sso' } : null));
  try {
    expect(await refusal(before.secret)).toEqual({ status: 403, code: 'sso_required' });
    expect(await refusal(appTokens.access_token)).toEqual({ status: 403, code: 'sso_required' });
    expect(await refusal(viaSso.secret)).toBeNull();
  } finally {
    off();
  }
});

it('signing an account out everywhere also ends its tokens and the apps it authorised', async () => {
  const bob = await createUser({ name: 'Bob', email: 'bob@apiauth.test.freero.app', password: 'password-123' });
  const pat = await token(bob.id);
  const app = await authorizeApp(bob.id);
  const issued = await exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: app.verifier });
  expect(await refusal(issued.access_token)).toBeNull();
  await endSessionsOf(bob.id); // e.g. a password reset or "this wasn't me"
  expect(await refusal(pat.secret)).toEqual({ status: 401, code: 'invalid_token' });
  expect(await refusal(issued.access_token)).toEqual({ status: 401, code: 'invalid_token' });
  await expect(exchange({ grant_type: 'refresh_token', client_id: app.clientId, refresh_token: issued.refresh_token })).rejects.toMatchObject({ error: 'invalid_grant' });
});

it('an authorization code works once and only with its PKCE verifier; a replayed refresh token ends the app’s access', async () => {
  const app = await authorizeApp(alice.id);
  await expect(exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: randomBytes(32).toString('base64url') })).rejects.toMatchObject({ error: 'invalid_grant' });
  // The failed attempt used the code up: a stolen code can't be retried with guesses.
  await expect(exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: app.verifier })).rejects.toMatchObject({ error: 'invalid_grant' });

  const again = await authorizeApp(alice.id);
  const first = await exchange({ grant_type: 'authorization_code', client_id: again.clientId, code: again.code, code_verifier: again.verifier, redirect_uri: again.redirectUri });
  const second = await exchange({ grant_type: 'refresh_token', client_id: again.clientId, refresh_token: first.refresh_token });
  expect(await refusal(second.access_token)).toBeNull();
  // Someone replays the first refresh token: the whole consent ends, the legitimate tokens too.
  await expect(exchange({ grant_type: 'refresh_token', client_id: again.clientId, refresh_token: first.refresh_token })).rejects.toMatchObject({ error: 'invalid_grant' });
  expect(await refusal(second.access_token)).toEqual({ status: 401, code: 'invalid_token' });
  await expect(exchange({ grant_type: 'refresh_token', client_id: again.clientId, refresh_token: second.refresh_token })).rejects.toMatchObject({ error: 'invalid_grant' });
});

it('apps can only register redirects that run no script and leave the machine over https; a loopback redirect matches any port', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://evil.example/cb', 'https://app.example/cb#frag', 'https://user:pw@app.example/cb'])
    expect(cleanRedirectUri(bad)).toBeNull();
  for (const good of ['https://app.example/cb', 'http://127.0.0.1:3000/cb', 'http://localhost/cb', 'vscode://freero.auth/cb']) expect(cleanRedirectUri(good)).toBe(good);
  expect(redirectMatches(['http://127.0.0.1:3000/cb'], 'http://127.0.0.1:51234/cb')).toBe(true);
  expect(redirectMatches(['http://127.0.0.1:3000/cb'], 'http://127.0.0.1:51234/other')).toBe(false);
  expect(redirectMatches(['https://app.example/cb'], 'https://app.example:8443/cb')).toBe(false);
});

it('turning API access off in a team stops the next call there; an admin’s block stops one credential, only in that team', async () => {
  const team = (await createTeamWorkspace(alice.id, 'Platform')).id;
  const personal = await ensurePersonalWorkspace(alice.id);
  const a = await authenticate(bearer((await token(alice.id)).secret), R);
  const b = await authenticate(bearer((await token(alice.id)).secret), R);
  const refused = (p: Promise<void>) => p.then(
    () => null,
    (e: { status: number; code?: string }) => e.code,
  );
  expect(await refused(useInWorkspace(a, team))).toBeNull();
  await setWorkspaceApiAccess(team, alice.id, false);
  expect(await refused(useInWorkspace(a, team))).toBe('api_disabled');
  expect(await refused(useInWorkspace(a, personal))).toBeNull();
  await setWorkspaceApiAccess(team, alice.id, true);
  await setCredentialBlocked(team, alice.id, a.credentialId, true);
  expect(await refused(useInWorkspace(a, team))).toBe('api_credential_blocked');
  expect(await refused(useInWorkspace(b, team))).toBeNull();
  expect(await refused(useInWorkspace(a, personal))).toBeNull();
});

it('an MCP client asking for everything gets read + suggest unless the person turns writing on, and its token works only at /mcp', async () => {
  const reg = (await registerDynamicClient({ client_name: 'Assistant', redirect_uris: ['http://127.0.0.1:7777/cb'] })) as { client_id: string };
  const consent = async (grant?: string[]) => {
    const verifier = randomBytes(32).toString('base64url');
    const checked = await checkAuthorizeRequest({
      response_type: 'code',
      client_id: reg.client_id,
      redirect_uri: 'http://127.0.0.1:7777/cb',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      resource: 'http://freero.test/mcp',
    });
    if (!('ok' in checked)) throw new Error(JSON.stringify(checked));
    const code = new URL(await decide(alice.id, 'password', checked.ok, true, grant)).searchParams.get('code')!;
    return exchange({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: verifier });
  };
  const byDefault = await consent();
  expect(byDefault.scope.split(' ').sort()).toEqual(['boards:read', 'boards:suggest']);
  expect(await authenticate(bearer(byDefault.access_token), '/mcp').then((c) => c.scopes.sort())).toEqual(['boards:read', 'boards:suggest']);
  expect(await refusal(byDefault.access_token)).toEqual({ status: 401, code: 'invalid_token' }); // not for the REST API
  const withWrite = await consent(['boards:write']);
  expect(withWrite.scope.split(' ').sort()).toEqual(['boards:read', 'boards:suggest', 'boards:write']);
});

it('revoking a token or an app withdraws what it suggested on every board — never another credential’s, nor the same app’s for someone else', async () => {
  registerOutboxConsumer(suggestionWithdrawalsConsumer);
  const carol = await createUser({ name: 'Carol', email: 'carol@apiauth.test.freero.app', password: 'password-123' });
  const dan = await createUser({ name: 'Dan', email: 'dan@apiauth.test.freero.app', password: 'password-123' });
  const pat = await token(carol.id, 'password', ['boards:suggest']);
  const app = await authorizeApp(carol.id);
  await authorizeApp(dan.id, 'password', app.clientId); // the same app, for Dan too
  const boards = [(await createBoard(carol.id, 'Roadmap', '')).id, (await createBoard(carol.id, 'Retro', '')).id];
  const suggest = (boardId: string, userId: string, via: { kind: 'app' | 'token'; id: string; name: string }) =>
    proposeSuggestions(boardId, { userId, role: 'editor', name: 'Someone', via }, { description: via.name }, () => ({
      change: { create: [{ id: `s${Math.random().toString(36).slice(2, 10)}`, type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text: 'Idea', color: 'yellow' } as never] },
    }));
  for (const b of boards) {
    await suggest(b, carol.id, { kind: 'token', id: pat.token.id, name: 'ci' });
    await suggest(b, carol.id, { kind: 'app', id: app.clientId, name: 'Agent' });
    await suggest(b, dan.id, { kind: 'app', id: app.clientId, name: 'Agent' });
  }
  const pending = async (b: string) => (await readBoardView(b, { userId: carol.id, role: 'owner' })).suggestions.map((s) => `${s.author.userId === carol.id ? 'carol' : 'dan'}:${s.author.name}`).sort();
  expect(await pending(boards[1])).toEqual(['carol:Agent', 'carol:ci', 'dan:Agent']);

  await revokePersonalToken(carol.id, pat.token.id);
  await drainOutbox(SUGGESTION_WITHDRAWALS_CONSUMER);
  for (const b of boards) expect(await pending(b)).toEqual(['carol:Agent', 'dan:Agent']);

  await revokeApp(carol.id, app.clientId);
  await drainOutbox(SUGGESTION_WITHDRAWALS_CONSUMER);
  for (const b of boards) expect(await pending(b)).toEqual(['dan:Agent']);
});
