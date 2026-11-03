// Microsoft Teams and Microsoft 365 Copilot (#112, #113, #114) over real HTTP: the bot endpoint
// against a stand-in for the Bot Connector's OpenID metadata, with tokens signed here by our own
// RSA keys (the real service signs with its own; the checks are the same), the framing of the Teams
// pages, and the packages an organisation uploads.
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, setBoardEmbeddable } from '../boards/index';
import { mcpToolDescriptions } from '../mcp/index';
import { BotTokenValidator } from './botAuth';
import teamsRoutes from './routes';

const BOT_ID = '6f1c2d3e-4a5b-4c6d-8e7f-9a0b1c2d3e4f';
const APP_ID = '0b1c2d3e-4f5a-4b6c-8d7e-9f0a1b2c3d4e';
const SERVICE_URL = 'https://smba.trafficmanager.net/amer/';
const RECORDED = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures/queryLink.invoke.json'), 'utf8');

interface Signer {
  kid: string;
  privateKey: KeyObject;
  jwk: Record<string, unknown>;
}
const signer = (endorsements: string[] = ['msteams']): Signer => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = randomUUID();
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, kty: 'RSA', use: 'sig', endorsements } };
};

// The Bot Connector's keys: one endorsed for Teams, one endorsed for another channel only.
const KEY = signer();
const SKYPE_KEY = signer(['skype']);
let published: Signer[] = [KEY, SKYPE_KEY];
let metadataFetches = 0;
let metadataUrl = '';
let identity: http.Server;
let freero: http.Server;
let base = '';
let dir = '';
let ownerId = '';

beforeAll(async () => {
  // The Bot Connector's OpenID metadata and keys, as login.botframework.com serves them.
  identity = http.createServer((req, res) => {
    const origin = `http://127.0.0.1:${(identity.address() as AddressInfo).port}`;
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/.well-known/openidconfiguration') {
      metadataFetches++;
      return void res.end(JSON.stringify({ issuer: 'https://api.botframework.com', jwks_uri: `${origin}/v1/.well-known/keys`, id_token_signing_alg_values_supported: ['RS256'] }));
    }
    if (req.url === '/v1/.well-known/keys') return void res.end(JSON.stringify({ keys: published.map((s) => s.jwk) }));
    res.statusCode = 404;
    res.end('{}');
  });
  await new Promise<void>((r) => identity.listen(0, '127.0.0.1', r));
  metadataUrl = `http://127.0.0.1:${(identity.address() as AddressInfo).port}/v1/.well-known/openidconfiguration`;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-teams-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Freero</title></head><body></body></html>');
  const config = await openTestDb({
    PUBLIC_URL: 'https://freero.test',
    FREERO_WEB_DIST: dir,
    TEAMS_APP_ID: APP_ID,
    TEAMS_BOT_ID: BOT_ID,
    TEAMS_BOT_OPENID_METADATA_URL: metadataUrl,
    COPILOT_APP_ID: '9e8d7c6b-5a49-4382-b1a0-f9e8d7c6b5a4',
    COPILOT_OAUTH_REFERENCE_ID: 'b3BlbmlkLXJlZ2lzdHJhdGlvbi0xMjM0',
    RATE_LIMIT_TEAMS_UNFURL: '50/1m',
  });
  const app = createApp(config);
  app.use('/', teamsRoutes({ config, onShutdown: () => undefined } as unknown as ServerContext));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  freero = http.createServer(app);
  await new Promise<void>((r) => freero.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(freero.address() as AddressInfo).port}`;
  ownerId = (await createUser({ name: 'Rosa', email: 'rosa@teams.test.freero.app', password: 'password-123' }, { emailVerified: true })).id;
});
afterAll(async () => {
  await new Promise((r) => freero.close(r));
  await new Promise((r) => identity.close(r));
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

function token(s: Signer, claims: Record<string, unknown> = {}, alg = 'RS256'): string {
  const now = Math.floor(Date.now() / 1000);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const head = enc({ alg, typ: 'JWT', kid: s.kid, x5t: s.kid });
  const body = enc({ iss: 'https://api.botframework.com', aud: BOT_ID, nbf: now - 10, exp: now + 3600, serviceurl: SERVICE_URL, ...claims });
  return `${head}.${body}.${sign('RSA-SHA256', Buffer.from(`${head}.${body}`), s.privateKey).toString('base64url')}`;
}

const invoke = (url: string, auth: string | null, patch: Record<string, unknown> = {}) =>
  fetch(`${base}/api/integrations/teams/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ ...JSON.parse(RECORDED.replace('{{URL}}', url).replace('{{BOT_ID}}', BOT_ID)), ...patch }),
  });

type InvokeBody = { composeExtension: { type: string; attachments: Array<{ contentType: string; content: unknown; preview: { content: unknown } }> } };

it('a Teams link preview signed by the Bot Connector shows a public board’s title and description as plain text, and a private board, a doc or a missing board as one card that names nothing', async () => {
  const key = KEY;
  const open = await createBoard(ownerId, 'Roadmap [click](https://evil.test) **Q4**', 'Everything for the November launch', 'viewer');
  const closed = await createBoard(ownerId, 'Salaries 2027', 'Do not share');

  const res = await invoke(`https://freero.test/board/${open.id}`, token(key));
  expect(res.status).toBe(200);
  const body = (await res.json()) as InvokeBody;
  const [a] = body.composeExtension.attachments;
  expect(a.contentType).toBe('application/vnd.microsoft.card.adaptive');
  const card = JSON.stringify(a.content);
  expect(card).toContain('Everything for the November launch');
  // The title is a TextRun (never Markdown): its brackets can't become a link in Teams.
  const runs = (a.content as { body: Array<{ type: string; inlines?: Array<{ type: string; text: string }> }> }).body.filter((b) => b.inlines?.some((i) => i.text.includes('Roadmap')));
  expect(runs.map((b) => [b.type, b.inlines?.[0].type])).toEqual([['RichTextBlock', 'TextRun']]);

  const generic = new Set<string>();
  for (const url of [`https://freero.test/board/${closed.id}`, 'https://freero.test/board/no-such-board', 'https://freero.test/doc/abc']) {
    const r = (await (await invoke(url, token(key))).json()) as InvokeBody;
    const text = JSON.stringify(r.composeExtension.attachments[0].content).replace(url, '<url>');
    expect(text).not.toMatch(/Salaries|Do not share/);
    generic.add(text);
  }
  expect(generic.size).toBe(1);
  // Another host's link gets no card at all.
  const elsewhere = (await (await invoke('https://elsewhere.test/board/x', token(key))).json()) as InvokeBody;
  expect(elsewhere.composeExtension.attachments).toEqual([]);
});

it('requests the Bot Connector didn’t sign for this bot are refused before any board is read', async () => {
  const key = KEY;
  const notPublished = signer();
  const otherChannel = SKYPE_KEY;
  const url = `https://freero.test/board/${(await createBoard(ownerId, 'Public board', '', 'viewer')).id}`;
  const now = Math.floor(Date.now() / 1000);
  const refused: Array<[string, string | null, number, Record<string, unknown>?]> = [
    ['no token', null, 401],
    ['a key the Bot Connector doesn’t publish', token(notPublished), 401],
    ['another issuer', token(key, { iss: 'https://sts.windows.net/attacker/' }), 401],
    ['another bot’s audience', token(key, { aud: '11111111-2222-4333-8444-555555555555' }), 401],
    ['expired beyond the five-minute skew', token(key, { exp: now - 6 * 60, nbf: now - 3600 }), 401],
    ['for another service URL than the activity names', token(key, { serviceurl: 'https://attacker.test/' }), 401],
    ['an unsigned token (alg none)', `${Buffer.from(JSON.stringify({ alg: 'none', kid: key.kid })).toString('base64url')}.${token(key).split('.')[1]}.`, 401],
    ['a key not endorsed for Teams', token(otherChannel), 403],
    ['a tampered payload', `${token(key).split('.')[0]}.${Buffer.from(JSON.stringify({ iss: 'https://api.botframework.com', aud: BOT_ID, exp: now + 60, serviceurl: SERVICE_URL, extra: 1 })).toString('base64url')}.${token(key).split('.')[2]}`, 401],
  ];
  for (const [what, auth, status] of refused) {
    const res = await invoke(url, auth);
    expect([what, res.status]).toEqual([what, status]);
    expect(JSON.stringify(await res.json()), what).not.toContain('composeExtension');
  }
  // Within the skew it is still the Bot Connector's token.
  expect((await invoke(url, token(key, { exp: now - 60 }))).status).toBe(200);
});

it('a signing key the Bot Connector rolls in is fetched once and accepted, while tokens naming made-up keys can’t make Freero fetch the keys again and again', async () => {
  const validator = new BotTokenValidator(BOT_ID, metadataUrl);
  const activity = { serviceUrl: SERVICE_URL, channelId: 'msteams' };
  const header = (s: Signer) => `Bearer ${token(s)}`;
  expect(await validator.validate(header(KEY), activity)).toMatchObject({ ok: true });
  const rolled = signer();
  published = [...published, rolled];
  const before = metadataFetches;
  expect(await validator.validate(header(rolled), activity)).toMatchObject({ ok: true });
  expect(await validator.validate(header(rolled), activity)).toMatchObject({ ok: true });
  for (let i = 0; i < 5; i++) expect(await validator.validate(header(signer()), activity)).toMatchObject({ ok: false, reason: 'unknown_key' });
  expect(metadataFetches - before).toBe(1);
});

it('the tab page is framed by Teams only while its board allows embedding, never by another site; the configuration page is framed by Teams', async () => {
  const board = await createBoard(ownerId, 'Planning', '');
  const ancestors = async (p: string) => {
    const res = await fetch(base + p);
    expect(res.status).toBe(200);
    return /frame-ancestors ([^;]+)/.exec(res.headers.get('content-security-policy') ?? '')?.[1];
  };
  expect(await ancestors(`/teams/b/${board.id}`)).toBe("'none'");
  await setBoardEmbeddable(board.id, ownerId, true);
  const framed = await ancestors(`/teams/b/${board.id}`);
  expect(framed).toContain('https://teams.microsoft.com');
  expect(framed?.split(' ')).not.toContain('*');
  expect(framed?.split(' ').every((s) => s.startsWith('https://'))).toBe(true);
  expect(await ancestors('/teams/config')).toBe(framed);
});

it('the Teams app package points its tab, link previews and valid domains at this instance, with the icon sizes Teams requires', async () => {
  const res = await fetch(`${base}/api/integrations/teams/app-package`);
  expect(res.headers.get('content-type')).toBe('application/zip');
  const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
  expect(Object.keys(files).sort()).toEqual(['color.png', 'manifest.json', 'outline.png']);
  const m = JSON.parse(Buffer.from(files['manifest.json']).toString('utf8'));
  expect(m.id).toBe(APP_ID);
  expect(m.validDomains).toEqual(['freero.test']);
  expect(m.configurableTabs[0].configurationUrl).toBe('https://freero.test/teams/config');
  expect(m.configurableTabs[0].context).toEqual(expect.arrayContaining(['meetingSidePanel', 'meetingStage', 'channelTab']));
  expect(m.composeExtensions[0]).toMatchObject({ botId: BOT_ID, messageHandlers: [{ type: 'link', value: { domains: ['freero.test'] } }] });
  // The configuration page the manifest names is the one Teams may frame.
  expect((await fetch(`${base}${new URL(m.configurableTabs[0].configurationUrl).pathname}`)).headers.get('content-security-policy')).toContain('https://teams.microsoft.com');

  const png = (b: Uint8Array) => {
    const buf = Buffer.from(b);
    const size = [buf.readUInt32BE(16), buf.readUInt32BE(20)];
    // IDAT → RGBA rows (filter byte 0 each): Teams wants the outline white on transparent, nothing else.
    const idat: Buffer[] = [];
    for (let o = 8; o < buf.length; ) {
      const len = buf.readUInt32BE(o);
      if (buf.toString('ascii', o + 4, o + 8) === 'IDAT') idat.push(buf.subarray(o + 8, o + 8 + len));
      o += len + 12;
    }
    return { size, rows: inflateSync(Buffer.concat(idat)) };
  };
  expect(png(files['color.png']).size).toEqual([192, 192]);
  const outline = png(files['outline.png']);
  expect(outline.size).toEqual([32, 32]);
  let opaque = 0;
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const o = y * (32 * 4 + 1) + 1 + x * 4;
      const [r, g, b, a] = outline.rows.subarray(o, o + 4);
      if (a > 0) expect([r, g, b]).toEqual([255, 255, 255]);
      if (a === 255) opaque++;
    }
  expect(opaque).toBeGreaterThan(100); // the mark is there, not an empty square
});

it('the Copilot agent calls Freero’s MCP server with the tools it really offers, signs in through the OAuth vault, and asks the person before any change', async () => {
  const files = unzipSync(new Uint8Array(await (await fetch(`${base}/api/integrations/copilot/agent-package`)).arrayBuffer()));
  const json = (f: string) => JSON.parse(Buffer.from(files[f]).toString('utf8'));
  const manifest = json('manifest.json');
  const agent = json(manifest.copilotAgents.declarativeAgents[0].file);
  const plugin = json(agent.actions[0].file);
  const [runtime] = plugin.runtimes;
  expect(runtime.spec.url).toBe('https://freero.test/mcp');
  expect(runtime.auth).toEqual({ type: 'OAuthPluginVault', reference_id: 'b3BlbmlkLXJlZ2lzdHJhdGlvbi0xMjM0' });
  // The tools listed in the package are the server's own descriptions, schemas included.
  const offered = new Map(mcpToolDescriptions().map((t) => [t.name, t]));
  for (const t of runtime.spec.mcp_tool_description.tools) expect(t.inputSchema).toEqual(offered.get(t.name)?.inputSchema);
  expect(runtime.run_for_functions).toEqual(plugin.functions.map((f: { name: string }) => f.name));
  expect(runtime.run_for_functions).not.toContain('delete_items');
  // Reading needs no confirmation; anything that writes or proposes does.
  const confirms = (name: string) => !!plugin.functions.find((f: { name: string }) => f.name === name)?.capabilities?.confirmation;
  expect([confirms('get_board_outline'), confirms('search_boards'), confirms('add_stickies'), confirms('add_diagram')]).toEqual([false, false, true, true]);
});
