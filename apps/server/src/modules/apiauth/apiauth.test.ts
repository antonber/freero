// API credentials against a real (in-memory) database: what makes a token stop working, the OAuth
// code and refresh rules, and a team's API switch.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MCP_SCOPES } from '@freero/shared';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, endSessionsOf, onSignInRestriction } from '../auth/index';
import { createBoard } from '../boards/index';
import { proposeSuggestions, readBoardView, SUGGESTION_WITHDRAWALS_CONSUMER, suggestionWithdrawalsConsumer } from '../realtime/index';
import { createTeamWorkspace, ensurePersonalWorkspace } from '../workspaces/index';
import { authenticate, createPersonalToken, registerProtectedResource, revokePersonalToken, setTokenPaused, useInWorkspace } from './credentials';
import { authenticateEmbed, mintEmbedTicket, redeemEmbedTicket } from './embed';
import initApiAuth from './init';
import { authorizationServerMetadata, checkAuthorizeRequest, cleanRedirectUri, decide, redirectMatches, REFRESH_RETRY_WINDOW_MS, registerClient, registerDynamicClient, revokeApp, tokenRequest } from './oauth';
import { setCredentialBlocked, setWorkspaceApiAccess } from './workspacePolicy';

const R = '/api/v1';
/** The consent screen's context: this server's issuer (PUBLIC_URL below), nobody fetching metadata. */
const AT = { issuer: 'http://freero.test', userId: null };
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
  const checked = await checkAuthorizeRequest(params, AT);
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

it('an authorization code works once and only with its PKCE verifier; a refresh token replayed after the app moved on, or after the retry window, ends the app’s access', async () => {
  const app = await authorizeApp(alice.id);
  await expect(exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: randomBytes(32).toString('base64url') })).rejects.toMatchObject({ error: 'invalid_grant' });
  // The failed attempt used the code up: a stolen code can't be retried with guesses.
  await expect(exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: app.verifier })).rejects.toMatchObject({ error: 'invalid_grant' });

  const refresh = (clientId: string, t: { refresh_token: string }) => exchange({ grant_type: 'refresh_token', client_id: clientId, refresh_token: t.refresh_token });
  const replayEndsConsent = async (clientId: string, old: { refresh_token: string }, live: { access_token: string; refresh_token: string }) => {
    await expect(refresh(clientId, old)).rejects.toMatchObject({ error: 'invalid_grant' });
    expect(await refusal(live.access_token)).toEqual({ status: 401, code: 'invalid_token' });
    await expect(refresh(clientId, live)).rejects.toMatchObject({ error: 'invalid_grant' });
  };

  // Within seconds, but the app already refreshed with its new token: the old one can only be a copy.
  const again = await authorizeApp(alice.id);
  const first = await exchange({ grant_type: 'authorization_code', client_id: again.clientId, code: again.code, code_verifier: again.verifier, redirect_uri: again.redirectUri });
  const second = await refresh(again.clientId, first);
  const third = await refresh(again.clientId, second);
  expect(await refusal(third.access_token)).toBeNull();
  await replayEndsConsent(again.clientId, first, third);

  // The new token never used, but the old one comes back after the retry window: a copy too.
  const later = await authorizeApp(alice.id);
  const one = await exchange({ grant_type: 'authorization_code', client_id: later.clientId, code: later.code, code_verifier: later.verifier });
  const two = await refresh(later.clientId, one);
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + REFRESH_RETRY_WINDOW_MS + 1000 });
  try {
    await replayEndsConsent(later.clientId, one, two);
  } finally {
    vi.useRealTimers();
  }
});

it('an app’s own refreshes sent at once with the same refresh token (parallel calls, or a retry after a lost response) keep it connected', async () => {
  const app = await authorizeApp(alice.id);
  const first = await exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: app.verifier });
  const both = await Promise.all([1, 2].map(() => exchange({ grant_type: 'refresh_token', client_id: app.clientId, refresh_token: first.refresh_token })));
  for (const t of both) expect(await refusal(t.access_token)).toBeNull();
  // Whichever response the app kept, it goes on refreshing.
  const next = await exchange({ grant_type: 'refresh_token', client_id: app.clientId, refresh_token: both[1].refresh_token });
  expect(await refusal(next.access_token)).toBeNull();
});

it('reconnecting an app with less (fewer permissions, another resource) takes the rest away from the tokens and codes it already holds', async () => {
  const reg = (await registerDynamicClient({ client_name: 'Agent', redirect_uris: ['http://127.0.0.1:7777/cb'] })) as { client_id: string };
  const consent = async (grant: string[], resource = '/mcp') => {
    const verifier = randomBytes(32).toString('base64url');
    const checked = await checkAuthorizeRequest(
      {
        response_type: 'code',
        client_id: reg.client_id,
        redirect_uri: 'http://127.0.0.1:41000/cb',
        scope: 'boards:read boards:write',
        resource,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      },
      AT,
    );
    if (!('ok' in checked)) throw new Error(JSON.stringify(checked));
    const code = new URL(await decide(alice.id, 'password', checked.ok, true, grant)).searchParams.get('code')!;
    return () => exchange({ grant_type: 'authorization_code', client_id: reg.client_id, code, code_verifier: verifier });
  };
  const mcpScopes = (secret: string) => authenticate(bearer(secret), '/mcp').then((c) => c.scopes);
  const wide = await (await consent(['boards:write']))();
  const unredeemed = await consent(['boards:write']); // a code from the wide consent, not exchanged yet
  const board = await createBoard(alice.id, 'Plans', '');
  const view = await redeemEmbedTicket((await mintEmbedTicket(await authenticate(bearer(wide.access_token), '/mcp'), board.id)).ticket);
  expect(view?.session.maxRole).toBe('editor');
  // The person reconnects the app and turns "write boards" off.
  await (await consent([]))();
  expect(await mcpScopes(wide.access_token)).not.toContain('boards:write');
  expect(await authenticateEmbed(view!.token)).toBeNull(); // the live board view it opened as an editor
  const refreshed = await exchange({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: wide.refresh_token });
  expect(refreshed.scope.split(' ')).not.toContain('boards:write');
  expect((await unredeemed()).scope.split(' ')).not.toContain('boards:write');
  // Then reconnects it for the REST API only: what it held for the MCP server stops.
  await (await consent([], R))();
  await expect(mcpScopes(refreshed.access_token)).rejects.toMatchObject({ status: 401 });
  await expect(exchange({ grant_type: 'refresh_token', client_id: reg.client_id, refresh_token: refreshed.refresh_token })).rejects.toMatchObject({ error: 'invalid_grant' });
});

it('a refresh asking for more scopes than were granted keeps the app signed in with what was granted, and never widens it', async () => {
  const app = await authorizeApp(alice.id); // granted boards:read only
  const first = await exchange({ grant_type: 'authorization_code', client_id: app.clientId, code: app.code, code_verifier: app.verifier });
  const second = await exchange({ grant_type: 'refresh_token', client_id: app.clientId, refresh_token: first.refresh_token, scope: 'boards:read boards:write members:manage' });
  expect(second.scope).toBe('boards:read');
  // Still signed in: the new refresh token works (a refusal above would have burnt the old one).
  const third = await exchange({ grant_type: 'refresh_token', client_id: app.clientId, refresh_token: second.refresh_token, scope: 'boards:write' });
  expect(third.scope).toBe('boards:read');
  expect(await refusal(third.access_token)).toBeNull();
});

it('every authorization response — a code, a refusal, a bad request sent back to the app — names this server as the metadata does, so a client can’t be fooled by a mix-up (RFC 9207)', async () => {
  const meta = authorizationServerMetadata({} as Request);
  expect(meta.authorization_response_iss_parameter_supported).toBe(true);
  const at = { issuer: meta.issuer, userId: null };
  const reg = (await registerDynamicClient({ client_name: 'Agent', redirect_uris: ['https://agent.example/cb'] })) as { client_id: string };
  const ask = (extra: Record<string, string>) =>
    checkAuthorizeRequest(
      { response_type: 'code', client_id: reg.client_id, redirect_uri: 'https://agent.example/cb', state: 'st', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', ...extra },
      at,
    );
  const asked = await ask({});
  if (!('ok' in asked)) throw new Error(JSON.stringify(asked));
  const answers = [
    await decide(alice.id, 'password', asked.ok, true), // the code
    await decide(alice.id, 'password', asked.ok, false), // access_denied
    ...[await ask({ scope: 'everything' }), await ask({ code_challenge_method: 'plain' })].map((r) => ('redirect' in r ? r.redirect : JSON.stringify(r))), // errors sent back to the app
  ];
  for (const a of answers) {
    const q = new URL(a).searchParams;
    expect(q.get('iss'), a).toBe(meta.issuer);
    expect(q.get('state'), a).toBe('st');
  }
  expect(answers.map((a) => new URL(a).searchParams.get('code') ? 'code' : new URL(a).searchParams.get('error'))).toEqual(['code', 'access_denied', 'invalid_scope', 'invalid_request']);
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
    }, AT);
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

it('only a confidential app may skip PKCE, and its code then needs the client secret and no verifier (no downgrade)', async () => {
  const redirect = 'https://flows.example/cb';
  const confidential = await registerClient(alice.id, { name: 'Flows', redirectUris: [redirect], confidential: true });
  const publicApp = await registerClient(alice.id, { name: 'Phone app', redirectUris: [redirect] });
  const ask = (clientId: string) => checkAuthorizeRequest({ response_type: 'code', client_id: clientId, redirect_uri: redirect, scope: 'boards:read' }, AT);
  const refusedPublic = await ask(publicApp.client.clientId);
  expect('redirect' in refusedPublic && new URL(refusedPublic.redirect).searchParams.get('error')).toBe('invalid_request');

  const id = confidential.client.clientId;
  const codeFor = async () => {
    const checked = await ask(id);
    if (!('ok' in checked)) throw new Error(JSON.stringify(checked));
    return new URL(await decide(alice.id, 'password', checked.ok, true)).searchParams.get('code')!;
  };
  await expect(exchange({ grant_type: 'authorization_code', client_id: id, code: await codeFor() })).rejects.toMatchObject({ error: 'invalid_client' });
  await expect(exchange({ grant_type: 'authorization_code', client_id: id, client_secret: confidential.clientSecret, code: await codeFor(), code_verifier: 'v'.repeat(43) })).rejects.toMatchObject({ error: 'invalid_grant' });
  const ok = await exchange({ grant_type: 'authorization_code', client_id: id, client_secret: confidential.clientSecret, code: await codeFor() });
  expect(await refusal(ok.access_token)).toBeNull();
});
