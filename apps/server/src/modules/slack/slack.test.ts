// The operator's Slack app over real HTTP, against a stand-in for Slack's Web API (SLACK_API_URL):
// link unfurls (#88) — what a signed link_shared event makes Freero send to chat.unfurl, and which
// requests it refuses — and personal Slack (#105): Connect Slack's OAuth state, /freero, previews
// of private boards for people who connected, direct messages, disconnecting.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Request, Response } from 'express';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { runWithRequestContext } from '../../platform/requestContext';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { ipExemptionsOf, setCredentialIpExempt, setWorkspaceApiAccess } from '../apiauth/index';
import { createUser } from '../auth/index';
import { createBoard, listBoardsIn } from '../boards/index';
import { createTeamWorkspace, ensurePersonalWorkspace, setIpExemptionReader, updateWorkspaceSettings } from '../workspaces/index';
import { sendSlackDm } from './dm';
import { unlinkSlack } from './links';
import { SLACK_BOT_SCOPES, slackAppManifest } from './manifest';
import { finishSlackConnect, startSlackConnect } from './oauth';
import * as repo from './repo';
import slackRoutes from './routes';
import { answerLinkShared, type LinkSharedEvent } from './service';
import { slackSignature } from './signature';

const SECRET = 'slack-signing-secret-for-tests';
const CLIENT_SECRET = 'slack-client-secret-for-tests';
type Call = { method: string; auth: string | undefined; body: Record<string, any> };
const calls: Array<Call> = [];
const callsTo = (method: string) => calls.filter((c) => c.method === method);
let slackApi: http.Server;
let freero: http.Server;
let base: string;
let events: string;
let ownerId: string;

// Slack's answer to oauth.v2.access for a code "code:<team>:<user>[:<scopes>]"; the bot token of
// teams T1 and TOP… is the one in SLACK_BOT_TOKEN (the operator's own workspace).
function oauthAnswer(form: URLSearchParams) {
  if (form.get('client_secret') !== CLIENT_SECRET) return { ok: false, error: 'invalid_client' };
  const [tag, team, user, scopes] = (form.get('code') ?? '').split(':');
  if (tag !== 'code' || !team || !user) return { ok: false, error: 'invalid_code' };
  return {
    ok: true,
    access_token: team === 'T1' || team.startsWith('TOP') ? 'xoxb-test-token' : `xoxb-${team}`,
    token_type: 'bot',
    scope: scopes ?? SLACK_BOT_SCOPES.join(','),
    team: { id: team, name: `Team ${team}` },
    authed_user: { id: user },
  };
}

beforeAll(async () => {
  slackApi = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const method = (req.url ?? '').replace(/^\/api\//, '');
      const form = req.headers['content-type']?.startsWith('application/x-www-form-urlencoded');
      const body = form ? Object.fromEntries(new URLSearchParams(raw)) : raw ? JSON.parse(raw) : {};
      calls.push({ method, auth: req.headers.authorization, body });
      const answer =
        method === 'oauth.v2.access'
          ? oauthAnswer(new URLSearchParams(raw))
          : method === 'conversations.open'
            ? { ok: true, channel: { id: `D-${body.users}` } }
            : method === 'users.info'
              ? { ok: true, user: { name: 'ines', profile: { display_name: 'Ines P.' } } }
              : { ok: true };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(answer));
    });
  });
  await new Promise<void>((r) => slackApi.listen(0, '127.0.0.1', r));
  const config = await openTestDb({
    PUBLIC_URL: 'https://freero.test',
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_CLIENT_ID: '1234.5678',
    SLACK_CLIENT_SECRET: CLIENT_SECRET,
    SLACK_API_URL: `http://127.0.0.1:${(slackApi.address() as AddressInfo).port}/api`,
    RATE_LIMIT_SLACK_UNFURL: '3/1m',
  });
  const app = createApp(config);
  app.use('/api', slackRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  freero = http.createServer(app);
  await new Promise<void>((r) => freero.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(freero.address() as AddressInfo).port}/api/integrations/slack`;
  events = `${base}/events`;
  setIpExemptionReader(ipExemptionsOf); // as apiauth's init does at startup
  ownerId = (await createUser({ name: 'Ines', email: 'ines@slack.test.freero.app', password: 'password-123' }, { emailVerified: true })).id;
});
afterAll(async () => {
  await new Promise((r) => freero.close(r));
  await new Promise((r) => slackApi.close(r));
  await closeTestDb();
});

const signed = (raw: string, sign: { at?: number; secret?: string } | null): Record<string, string> => {
  const ts = String(Math.floor((sign?.at ?? Date.now()) / 1000));
  if (!sign) return {};
  return { 'x-slack-request-timestamp': ts, 'x-slack-signature': slackSignature(sign.secret ?? SECRET, ts, raw) };
};
const post = (body: unknown, sign: { at?: number; secret?: string; tamper?: boolean } | null = {}) => {
  const raw = JSON.stringify(body);
  const headers = signed(sign?.tamper ? `${raw} ` : raw, sign);
  return fetch(events, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: raw });
};
let n = 0;
const linkShared = (urls: string[], more: Partial<LinkSharedEvent> = {}, team = 'T1'): { team_id: string; event_id: string; type: string; event: LinkSharedEvent } => ({
  type: 'event_callback',
  team_id: team,
  event_id: `Ev${++n}`,
  event: { type: 'link_shared', channel: 'C1', message_ts: `1700000000.00${n}`, links: urls.map((url) => ({ domain: 'freero.test', url })), ...more },
});

// ---- "Connect Slack" through its real start and callback, as one browser ----

function fakeReq(query: Record<string, string>, cookie?: string): Request {
  return { query, headers: cookie ? { cookie } : {}, secure: true, protocol: 'https', get: () => 'freero.test' } as unknown as Request;
}
function fakeRes() {
  const out = { location: '', cookie: '' };
  const res = {
    cookie: (_name: string, value: string) => ((out.cookie = value), res),
    clearCookie: () => res,
    redirect: (_status: number, location: string) => void (out.location = location),
  };
  return { res: res as unknown as Response, out };
}
/** Starts Connect Slack for `userId`: the state Slack would send back and this browser's cookie. */
async function start(userId: string) {
  const { res, out } = fakeRes();
  await startSlackConnect(fakeReq({}), res, userId);
  const to = new URL(out.location);
  return { state: to.searchParams.get('state')!, cookie: `freero_slack_oauth=${out.cookie}`, to };
}
async function finish(userId: string, query: Record<string, string>, cookie?: string) {
  const { res, out } = fakeRes();
  await finishSlackConnect(fakeReq(query, cookie), res, userId);
  return out.location;
}
async function person(name: string) {
  return (await createUser({ name, email: `${name.toLowerCase()}-${++n}@slack.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id;
}
/** A Freero account linked to Slack user `slackUser` of `team` through a real consent. */
async function linked(name: string, team: string, slackUser: string) {
  const id = await person(name);
  const s = await start(id);
  expect(await finish(id, { state: s.state, code: `code:${team}:${slackUser}` }, s.cookie)).toBe('/settings?slack=connected#slack');
  return id;
}

const command = (fields: Record<string, string>, sign: { at?: number; secret?: string; tamper?: (raw: string) => string } | null = {}) => {
  const raw = new URLSearchParams({ command: '/freero', team_id: 'T1', response_url: 'https://hooks.slack.test/x', ...fields }).toString();
  const headers = signed(raw, sign);
  return fetch(`${base}/commands`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers }, body: sign?.tamper ? sign.tamper(raw) : raw });
};

it('a signed link_shared event unfurls a public board with its title and description, and a private board or a doc as the same generic card with no title', async () => {
  const open = await createBoard(ownerId, 'Launch <plan> & checklist', 'Everything for the November launch', 'viewer');
  const closed = await createBoard(ownerId, 'Salaries 2027', 'Do not share');
  const urls = [`https://freero.test/board/${open.id}`, `https://freero.test/board/${closed.id}?el=x`, 'https://freero.test/board/no-such-board', 'https://freero.test/doc/abc', 'https://elsewhere.test/board/x'];
  const res = await post(linkShared(urls));
  expect(res.status).toBe(200);
  await vi.waitFor(() => expect(callsTo('chat.unfurl')).toHaveLength(1));
  const [{ auth, body }] = callsTo('chat.unfurl');
  expect([auth, body.channel, body.ts]).toEqual(['Bearer xoxb-test-token', 'C1', '1700000000.001']);
  // Only Freero's own links are answered.
  expect(Object.keys(body.unfurls).sort()).toEqual(urls.slice(0, 4).sort());
  const text = (u: string) => JSON.stringify(body.unfurls[u]);
  expect(text(urls[0])).toContain('Launch &lt;plan&gt; &amp; checklist');
  expect(text(urls[0])).toContain('Everything for the November launch');
  // Not public, not there, not a board: one card that says nothing about it.
  expect(new Set([text(urls[1]), text(urls[2]), text(urls[3])]).size).toBe(1);
  expect(text(urls[1])).not.toMatch(/Salaries|Do not share/);
  expect(text(urls[1])).toContain('Sign in');
  calls.length = 0;
});

it('unsigned, wrongly signed and replayed (older than five minutes) requests are refused and nothing reaches Slack; the URL check is answered only when signed', async () => {
  const event = linkShared(['https://freero.test/board/whatever']);
  expect((await post(event, null)).status).toBe(401);
  expect((await post(event, { secret: 'not-the-secret' })).status).toBe(401);
  expect((await post(event, { tamper: true })).status).toBe(401);
  expect((await post(event, { at: Date.now() - 6 * 60_000 })).status).toBe(401);
  expect((await post({ type: 'url_verification', challenge: 'c-123' }, null)).status).toBe(401);
  const ok = await post({ type: 'url_verification', challenge: 'c-123' });
  expect(await ok.json()).toEqual({ challenge: 'c-123' });
  // A signed request still goes out, so the refusals above can't have been queued behind it.
  await post(linkShared(['https://freero.test/doc/x']));
  await vi.waitFor(() => expect(callsTo('chat.unfurl')).toHaveLength(1));
  expect(Object.keys(callsTo('chat.unfurl')[0].body.unfurls)).toEqual(['https://freero.test/doc/x']);
  calls.length = 0;
});

it('the app manifest an operator pastes into Slack points at the routes that answer Slack — events, /freero and the OAuth redirect — on the instance’s host, and deploy/ ships that same manifest', async () => {
  const manifest = slackAppManifest('https://freero.test');
  const at = new URL(manifest.settings.event_subscriptions.request_url);
  expect([at.host, manifest.features.unfurl_domains]).toEqual(['freero.test', ['freero.test']]);
  expect(manifest.settings.event_subscriptions.bot_events).toContain('link_shared');
  for (const url of [at.href, manifest.features.slash_commands[0].url]) {
    const served = await fetch(new URL(new URL(url).pathname, events), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(served.status, url).toBe(401); // there, and asking for Slack's signature (not a 404)
  }
  // Slack sends people back to exactly this address, which must be the callback Freero redeems with.
  const s = await start(ownerId);
  expect(manifest.oauth_config.redirect_urls).toEqual([s.to.searchParams.get('redirect_uri')]);
  const shipped = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../deploy/slack-app-manifest.json'), 'utf8'));
  expect(shipped).toEqual(slackAppManifest('https://freero.example.com'));
  calls.length = 0;
});

it('Slack retrying an event gets it answered once, and a workspace past its unfurl limit gets no more calls to chat.unfurl', async () => {
  const e = linkShared(['https://freero.test/doc/y']);
  expect(await answerLinkShared('T2', e.event_id, e.event)).toBe('unfurled');
  expect(await answerLinkShared('T2', e.event_id, e.event)).toBe('duplicate');
  const more = [linkShared(['https://freero.test/doc/y']), linkShared(['https://freero.test/doc/y']), linkShared(['https://freero.test/doc/y'])];
  const outcomes = [];
  for (const m of more) outcomes.push(await answerLinkShared('T2', m.event_id, m.event));
  expect(outcomes).toEqual(['unfurled', 'unfurled', 'rate_limited']);
  expect(callsTo('chat.unfurl')).toHaveLength(3);
  calls.length = 0;
});

it('Connect Slack links nothing when the callback is finished in another browser, by another account, a second time or after ten minutes — then links the Slack account Slack itself names', async () => {
  const alice = await person('Alice');
  const mallory = await person('Mallory');
  // A callback link Mallory started (her state, her Slack code) opened in Alice's browser: no cookie.
  const hers = await start(mallory);
  await expect(finish(alice, { state: hers.state, code: 'code:TM:UMALLORY' })).rejects.toMatchObject({ status: 400 });
  // Alice's state with Mallory's browser cookie, or finished by Mallory's account.
  const a1 = await start(alice);
  await expect(finish(alice, { state: a1.state, code: 'code:TM:UMALLORY' }, (await start(mallory)).cookie)).rejects.toMatchObject({ status: 400 });
  const a2 = await start(alice);
  await expect(finish(mallory, { state: a2.state, code: 'code:TM:UMALLORY' }, a2.cookie)).rejects.toMatchObject({ status: 400 });
  // A consent started more than ten minutes ago.
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  await repo.insertFlow(sha('old-state'), { userId: alice, browserHash: sha('old-browser') }, Date.now() - 1000);
  await expect(finish(alice, { state: 'old-state', code: 'code:TA:UALICE' }, 'freero_slack_oauth=old-browser')).rejects.toMatchObject({ status: 400 });
  expect(callsTo('oauth.v2.access')).toHaveLength(0); // no code was ever redeemed
  expect(await repo.linkOf(alice)).toBeNull();

  // An app whose scopes weren't updated yet can't send DMs: refused, nothing linked.
  const early = await start(alice);
  expect(await finish(alice, { state: early.state, code: 'code:TA:UALICE:links:read,links:write' }, early.cookie)).toMatch(/^\/settings\?slack_error=/);
  expect(await repo.linkOf(alice)).toBeNull();

  const ok = await start(alice);
  expect(ok.to.searchParams.get('client_id')).toBe('1234.5678');
  expect(await finish(alice, { state: ok.state, code: 'code:TA:UALICE' }, ok.cookie)).toBe('/settings?slack=connected#slack');
  const redeemed = callsTo('oauth.v2.access').at(-1)!.body;
  expect([redeemed.client_secret, redeemed.redirect_uri]).toEqual([CLIENT_SECRET, ok.to.searchParams.get('redirect_uri')]);
  expect(await repo.linkOf(alice)).toMatchObject({ teamId: 'TA', slackUserId: 'UALICE', dmChannel: 'D-UALICE', slackName: 'Ines P.' });
  // The same state can't be used again.
  await expect(finish(alice, { state: ok.state, code: 'code:TA:UOTHER' }, ok.cookie)).rejects.toMatchObject({ status: 400 });
  expect((await repo.linkOf(alice))?.slackUserId).toBe('UALICE');
  calls.length = 0;
});

it('/freero answers only requests Slack signed, and only for the Freero account linked to that Slack user: new creates a board in their personal workspace, words find only boards they can open', async () => {
  const kim = await linked('Kim', 'T1', 'UKIM');
  const other = await person('Other');
  await createBoard(other, 'Roadmap secret', ''); // someone else's private board
  const mine = await createBoard(kim, 'Roadmap 2027', '');

  // Forged, replayed, or signed and then changed to act as Kim: refused, no board made.
  const asKim = { user_id: 'UKIM', text: 'new Forged board' };
  expect((await command(asKim, null)).status).toBe(401);
  expect((await command(asKim, { secret: 'not-the-secret' })).status).toBe(401);
  expect((await command(asKim, { at: Date.now() - 6 * 60_000 })).status).toBe(401);
  expect((await command({ user_id: 'USTRANGER', text: 'new Forged board' }, { tamper: (raw) => raw.replace('USTRANGER', 'UKIM') })).status).toBe(401);
  // A Slack user who never connected learns nothing about boards.
  const stranger = await (await command({ user_id: 'USTRANGER', text: 'Roadmap' })).json();
  expect(stranger.text).toContain('Connect your Slack account');
  expect(stranger.text).not.toContain('Roadmap');

  const personal = await ensurePersonalWorkspace(kim);
  expect((await listBoardsIn(kim, personal, 'Forged')).length).toBe(0);
  const made = await (await command({ user_id: 'UKIM', text: 'new Q4 &lt;plan&gt;' })).json();
  expect(made.response_type).toBe('ephemeral');
  const created = (await listBoardsIn(kim, personal, 'Q4')).map((b) => b.title);
  expect(created).toEqual(['Q4 <plan>']);

  const found = (await (await command({ user_id: 'UKIM', text: 'roadmap' })).json()).text as string;
  expect(found).toContain(`/board/${mine.id}`);
  expect(found).not.toContain('secret');
});

it('a private board link posted by someone who connected Slack and can open it unfurls with its title; posted by anyone else it stays the generic card', async () => {
  const lee = await linked('Lee', 'TLEE', 'ULEE');
  const board = await createBoard(lee, 'Hiring plan', 'Q1 roles');
  const notHers = await createBoard(ownerId, 'Layoffs', '');
  const url = `https://freero.test/board/${board.id}`;
  const cards: string[] = [];
  // Lee's own board, the same link posted by someone who never connected, and a board Lee can't open.
  for (const [user, link] of [['ULEE', url], ['USOMEONE', url], ['ULEE', `https://freero.test/board/${notHers.id}`]]) {
    await post(linkShared([link], { user }, 'TLEE'));
    await vi.waitFor(() => expect(callsTo('chat.unfurl')).toHaveLength(cards.length + 1));
    const call = callsTo('chat.unfurl').at(-1)!;
    expect(call.auth).toBe('Bearer xoxb-TLEE'); // the app's token in Lee's Slack workspace
    cards.push(JSON.stringify(call.body.unfurls[link]));
  }
  expect(cards[0]).toContain('Hiring plan');
  expect(cards[0]).toContain('only people with access');
  expect(cards[1]).not.toContain('Hiring plan');
  expect(cards[2]).not.toContain('Layoffs');
  expect(cards[1]).toBe(cards[2]);
  calls.length = 0;
});

it('a direct message goes to the person’s DM with the app in their own Slack workspace, and board text in it can’t ping a channel or make a link', async () => {
  const max = await linked('Max', 'TMAX', 'UMAX');
  expect(await sendSlackDm(max, { title: 'Ann mentioned you in “<!channel> <https://evil.test|Click>”', quote: 'see <!here>', url: 'https://freero.test/board/b1', linkLabel: 'Open the comment' })).toBe('sent');
  const [dm] = callsTo('chat.postMessage');
  expect([dm.auth, dm.body.channel]).toEqual(['Bearer xoxb-TMAX', 'D-UMAX']);
  const sent = JSON.stringify(dm.body);
  expect(sent).not.toMatch(/<!channel>|<!here>|<https:\/\/evil/);
  expect(sent).toContain('<https://freero.test/board/b1|Open the comment>');
  expect(await sendSlackDm(await person('Nobody'), { title: 'x', url: 'https://freero.test/', linkLabel: 'x' })).toBe('not_linked');
  calls.length = 0;
});

it('disconnecting stops /freero for that person and revokes the app’s token in that Slack workspace once nobody there is connected — never the operator’s own SLACK_BOT_TOKEN', async () => {
  const pat = await linked('Pat', 'TPAT', 'UPAT');
  const sam = await linked('Sam', 'TPAT', 'USAM');
  const op = await linked('Op', 'TOPS', 'UOP'); // installed with the operator's own token
  await unlinkSlack(pat);
  expect(callsTo('auth.revoke')).toHaveLength(0); // Sam still uses it
  expect((await (await command({ team_id: 'TPAT', user_id: 'UPAT', text: 'x' })).json()).text).toContain('Connect your Slack account');
  await unlinkSlack(sam);
  expect(callsTo('auth.revoke').map((c) => c.auth)).toEqual(['Bearer xoxb-TPAT']);
  expect(await repo.teamToken('TPAT')).toBeNull();
  await unlinkSlack(op);
  expect(callsTo('auth.revoke')).toHaveLength(1);
  calls.length = 0;
});

it('Slack telling Freero the app was uninstalled from a workspace (signed) disconnects everyone there', async () => {
  const ray = await linked('Ray', 'TRAY', 'URAY');
  await post({ type: 'event_callback', team_id: 'TRAY', event_id: `Ev${++n}`, event: { type: 'app_uninstalled' } }, { secret: 'not-the-secret' });
  expect(await repo.linkOf(ray)).not.toBeNull();
  await post({ type: 'event_callback', team_id: 'TRAY', event_id: `Ev${++n}`, event: { type: 'app_uninstalled' } });
  await vi.waitFor(async () => expect(await repo.linkOf(ray)).toBeNull());
  expect(await repo.teamToken('TRAY')).toBeNull();
  calls.length = 0;
});

it('a board in a team workspace that keeps apps out — API access off, or an IP allowlist that doesn’t exempt the Slack app — never shows in /freero or as a private preview', async () => {
  const kai = await linked('Kai', 'TKAI', 'UKAI');
  const team = await createTeamWorkspace(kai, 'Corp dev');
  const board = await createBoard(kai, 'Merger plan', '', 'none', { workspaceId: team.id, projectId: null });
  const url = `https://freero.test/board/${board.id}`;
  const search = async () => (await (await command({ team_id: 'TKAI', user_id: 'UKAI', text: 'merger' })).json()).text as string;
  const preview = async () => {
    const before = callsTo('chat.unfurl').length;
    await post(linkShared([url], { user: 'UKAI' }, 'TKAI'));
    await vi.waitFor(() => expect(callsTo('chat.unfurl')).toHaveLength(before + 1));
    return JSON.stringify(callsTo('chat.unfurl').at(-1)!.body.unfurls[url]);
  };
  expect(await search()).toContain('Merger plan');

  await setWorkspaceApiAccess(team.id, kai, false);
  expect(await search()).not.toContain('Merger plan');
  expect(await preview()).not.toContain('Merger plan');
  await setWorkspaceApiAccess(team.id, kai, true);

  // Slack's servers ask, not Kai's office network: hidden until the workspace exempts the app.
  await runWithRequestContext({ reqId: 'office', userId: null, ip: '10.0.0.5', userAgent: null }, () => updateWorkspaceSettings(team.id, kai, { ipAllowlist: ['10.0.0.0/8'] }));
  expect(await search()).not.toContain('Merger plan');
  await setCredentialIpExempt(team.id, kai, `slack:${kai}`, true);
  expect(await search()).toContain('Merger plan');
  expect(await preview()).toContain('Merger plan');
  calls.length = 0;
});
