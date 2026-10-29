// Slack link unfurls (#88) over real HTTP, against a stand-in for Slack's Web API (SLACK_API_URL):
// what a signed link_shared event makes Freero send to chat.unfurl, and which requests it refuses.
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { slackAppManifest } from './manifest';
import slackRoutes from './routes';
import { answerLinkShared, type LinkSharedEvent } from './service';
import { slackSignature } from './signature';

const SECRET = 'slack-signing-secret-for-tests';
const calls: Array<{ auth: string | undefined; body: { channel: string; ts: string; unfurls: Record<string, { blocks: Array<Record<string, any>> }> } }> = [];
let slackApi: http.Server;
let freero: http.Server;
let events: string;
let ownerId: string;

beforeAll(async () => {
  slackApi = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/chat.unfurl') calls.push({ auth: req.headers.authorization, body: JSON.parse(body) });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => slackApi.listen(0, '127.0.0.1', r));
  const config = await openTestDb({
    PUBLIC_URL: 'https://freero.test',
    SLACK_SIGNING_SECRET: SECRET,
    SLACK_BOT_TOKEN: 'xoxb-test-token',
    SLACK_API_URL: `http://127.0.0.1:${(slackApi.address() as AddressInfo).port}/api`,
    RATE_LIMIT_SLACK_UNFURL: '3/1m',
  });
  const app = createApp(config);
  app.use('/api', slackRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  freero = http.createServer(app);
  await new Promise<void>((r) => freero.listen(0, '127.0.0.1', r));
  events = `http://127.0.0.1:${(freero.address() as AddressInfo).port}/api/integrations/slack/events`;
  ownerId = (await createUser({ name: 'Ines', email: 'ines@slack.test.freero.app', password: 'password-123' }, { emailVerified: true })).id;
});
afterAll(async () => {
  await new Promise((r) => freero.close(r));
  await new Promise((r) => slackApi.close(r));
  await closeTestDb();
});

const post = (body: unknown, sign: { at?: number; secret?: string; tamper?: boolean } | null = {}) => {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor((sign?.at ?? Date.now()) / 1000));
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (sign) {
    headers['x-slack-request-timestamp'] = ts;
    headers['x-slack-signature'] = slackSignature(sign.secret ?? SECRET, ts, sign.tamper ? `${raw} ` : raw);
  }
  return fetch(events, { method: 'POST', headers, body: raw });
};
let n = 0;
const linkShared = (urls: string[]): { team_id: string; event_id: string; type: string; event: LinkSharedEvent } => ({
  type: 'event_callback',
  team_id: 'T1',
  event_id: `Ev${++n}`,
  event: { type: 'link_shared', channel: 'C1', message_ts: `1700000000.00${n}`, links: urls.map((url) => ({ domain: 'freero.test', url })) },
});

it('a signed link_shared event unfurls a public board with its title and description, and a private board or a doc as the same generic card with no title', async () => {
  const open = await createBoard(ownerId, 'Launch <plan> & checklist', 'Everything for the November launch', 'viewer');
  const closed = await createBoard(ownerId, 'Salaries 2027', 'Do not share');
  const urls = [`https://freero.test/board/${open.id}`, `https://freero.test/board/${closed.id}?el=x`, 'https://freero.test/board/no-such-board', 'https://freero.test/doc/abc', 'https://elsewhere.test/board/x'];
  const res = await post(linkShared(urls));
  expect(res.status).toBe(200);
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  const [{ auth, body }] = calls;
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
  await vi.waitFor(() => expect(calls).toHaveLength(1));
  expect(Object.keys(calls[0].body.unfurls)).toEqual(['https://freero.test/doc/x']);
  calls.length = 0;
});

it('the app manifest an operator pastes into Slack points at the route that answers Slack, for the link_shared event on the instance’s host — and deploy/ ships that same manifest', async () => {
  const manifest = slackAppManifest('https://freero.test');
  const at = new URL(manifest.settings.event_subscriptions.request_url);
  expect([at.host, manifest.features.unfurl_domains, manifest.settings.event_subscriptions.bot_events]).toEqual(['freero.test', ['freero.test'], ['link_shared']]);
  const served = await fetch(new URL(at.pathname, events), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  expect(served.status).toBe(401); // there, and asking for Slack's signature (not a 404)
  const shipped = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../../deploy/slack-app-manifest.json'), 'utf8'));
  expect(shipped).toEqual(slackAppManifest('https://freero.example.com'));
});

it('Slack retrying an event gets it answered once, and a workspace past its unfurl limit gets no more calls to chat.unfurl', async () => {
  const e = linkShared(['https://freero.test/doc/y']);
  expect(await answerLinkShared('T2', e.event_id, e.event)).toBe('unfurled');
  expect(await answerLinkShared('T2', e.event_id, e.event)).toBe('duplicate');
  const more = [linkShared(['https://freero.test/doc/y']), linkShared(['https://freero.test/doc/y']), linkShared(['https://freero.test/doc/y'])];
  const outcomes = [];
  for (const m of more) outcomes.push(await answerLinkShared('T2', m.event_id, m.event));
  expect(outcomes).toEqual(['unfurled', 'unfurled', 'rate_limited']);
  expect(calls).toHaveLength(3);
  calls.length = 0;
});
