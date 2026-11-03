// Boards embedded live on other sites (#2): the real embed routes, framing headers and sockets on
// a real HTTP server, with real sessions. An embed must never show or allow more than the board's
// sharing does, and must stop the moment its owner, its workspace or a sign-out says so.
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import * as decoding from 'lib0/decoding';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PUBLIC_EMBED_VIEW_ONLY, PUBLIC_EMBED_WS_PROTOCOL, WS_CLOSE_EMBED_FULL, WS_MESSAGE_ROLE, type OEmbedResponse, type PublicEmbedInfo, type RoleMessage } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { attachWebSockets } from '../../platform/ws';
import { completeSignIn, createUser, endSessionsOf, onSessionEnd } from '../auth/index';
import { createBoard, setBoardEmbeddable, shareBoardByLink } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { endSessionSockets } from '../realtime/index';
import { createTeamWorkspace, updateWorkspace } from '../workspaces/index';
import embedRoutes from './routes';
import embedWs from './ws';

const PUBLIC_URL = 'http://freero.test';
let server: http.Server;
let sockets: { close(): void };
let base = '';
let wsBase = '';
let dir = '';
const open: WebSocket[] = [];

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-embed-'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><html><head><title>Freero</title></head><body></body></html>');
  const config = await openTestDb({ FREERO_WEB_DIST: dir, PUBLIC_URL, EMBED_MAX_VISITORS_PER_BOARD: '2', FREERO_DOC_IDLE_MS: '100' });
  const ctx = { config, onShutdown: () => undefined } as unknown as ServerContext;
  const app = createApp(config);
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/', embedRoutes(ctx));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  sockets = attachWebSockets(server, embedWs(ctx));
  onSessionEnd(endSessionSockets); // as realtime's socket routes do
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});
afterAll(async () => {
  for (const s of open) s.close();
  sockets.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => setTimeout(r, 300)); // rooms unload before the database closes
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let n = 0;
async function person(label: string): Promise<{ id: string; email: string; cookie: string }> {
  const email = `${label.toLowerCase()}-${++n}@embed-public.test.freero.app`;
  const { id } = await createUser({ name: label, email, password: 'password-123' }, { emailVerified: true });
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  expect(res.status).toBe(200);
  return { id, email, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

const post = (p: string, json: unknown, cookie?: string) =>
  fetch(base + p, { method: 'POST', headers: { origin: base, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(json) });

/** An embed socket: resolves with the role the server gave it, or the code it was closed with. */
function connect(boardId: string, protocols: string[]): Promise<{ ws: WebSocket; role?: RoleMessage; closed?: number }> {
  const ws = new WebSocket(`${wsBase}/ws/embed/b/${boardId}`, protocols, { headers: { origin: base } });
  open.push(ws);
  return new Promise((resolve) => {
    ws.on('message', (data: Buffer) => {
      const d = decoding.createDecoder(new Uint8Array(data));
      if (decoding.readVarUint(d) === WS_MESSAGE_ROLE) resolve({ ws, role: JSON.parse(decoding.readVarString(d)) as RoleMessage });
    });
    ws.on('close', (code) => resolve({ ws, closed: code }));
  });
}
const closedWith = (ws: WebSocket) => new Promise<number>((r) => (ws.readyState === WebSocket.CLOSED ? r(-1) : ws.once('close', (code) => r(code))));

it('an embed shows visitors only what the link lets them see, read-only even where the link edits, and lets no visitor into a private board', async () => {
  const owner = await person('Owner');
  const pub = await createBoard(owner.id, 'Roadmap', '', 'editor');
  const closed = await createBoard(owner.id, 'Salaries', '', 'none');
  await setBoardEmbeddable(pub.id, owner.id, true);
  await setBoardEmbeddable(closed.id, owner.id, true);

  const visitor = await connect(pub.id, [PUBLIC_EMBED_WS_PROTOCOL]);
  expect(visitor.role?.role).toBe('viewer');
  expect((await connect(closed.id, [PUBLIC_EMBED_WS_PROTOCOL])).closed).toBe(4403);
  // The private board's embed asks people to sign in without naming the board.
  const info = (await (await fetch(`${base}/api/embed/b/${closed.id}`)).json()) as PublicEmbedInfo;
  expect(info).toMatchObject({ status: 'on', visitor: null, title: null });
});

it('only an embeddable board’s embed page may be framed by other sites; its board page, the sign-in popup and boards with embedding off stay unframable', async () => {
  const owner = await person('Framer');
  const team = await createTeamWorkspace(owner.id, 'Studio');
  const board = await createBoard(owner.id, 'Moodboard', '', 'viewer', { workspaceId: team.id });
  const plain = await createBoard(owner.id, 'Notes', '', 'viewer');
  await setBoardEmbeddable(board.id, owner.id, true);
  const framing = async (p: string) => {
    const res = await fetch(base + p);
    const csp = res.headers.get('content-security-policy') ?? '';
    return { ancestors: /frame-ancestors ([^;]+)/.exec(csp)?.[1], xfo: res.headers.get('x-frame-options'), opener: res.headers.get('cross-origin-opener-policy') };
  };

  expect(await framing(`/embed/b/${board.id}`)).toMatchObject({ ancestors: '*', xfo: null });
  expect(await framing(`/board/${board.id}`)).toMatchObject({ ancestors: "'none'", xfo: 'DENY' });
  expect(await framing(`/embed/connect/${board.id}`)).toMatchObject({ xfo: 'DENY', opener: 'unsafe-none' });
  expect(await framing(`/embed/b/${plain.id}`)).toMatchObject({ ancestors: "'none'", xfo: 'DENY' });

  await updateWorkspace(team.id, owner.id, { policies: { boardEmbeds: 'off' } });
  expect(await framing(`/embed/b/${board.id}`)).toMatchObject({ ancestors: "'none'", xfo: 'DENY' });
  await expect(setBoardEmbeddable(plain.id, owner.id, true)).resolves.toBeUndefined(); // a personal board has no policy
  const other = await createBoard(owner.id, 'Later', '', 'viewer', { workspaceId: team.id });
  await expect(setBoardEmbeddable(other.id, owner.id, true)).rejects.toMatchObject({ status: 403 });
});

it('turning embedding off, or the workspace’s policy off, closes the embeds already open on other sites — and nothing else about sharing does', async () => {
  const owner = await person('Closer');
  const team = await createTeamWorkspace(owner.id, 'Agency');
  const a = await createBoard(owner.id, 'Launch', '', 'viewer');
  const b = await createBoard(owner.id, 'Brief', '', 'viewer', { workspaceId: team.id });
  await setBoardEmbeddable(a.id, owner.id, true);
  await setBoardEmbeddable(b.id, owner.id, true);
  const onA = await connect(a.id, [PUBLIC_EMBED_WS_PROTOCOL]);
  const onB = await connect(b.id, [PUBLIC_EMBED_WS_PROTOCOL]);
  const { token } = (await (await post(`/api/embed/b/${a.id}/token`, {}, owner.cookie)).json()) as { token: string };
  const member = await connect(a.id, [PUBLIC_EMBED_WS_PROTOCOL, token]);
  expect(onA.role?.role).toBe('viewer');
  expect(onB.role?.role).toBe('viewer');
  expect(member.role?.role).toBe('owner');

  // Every access refresh re-checks the embeds: one that still may stay, stays.
  await shareBoardByLink(a.id, { id: owner.id, emailVerified: true }, 'commenter');
  await new Promise((r) => setTimeout(r, 100));
  expect(onA.ws.readyState).toBe(WebSocket.OPEN);

  const aClosed = Promise.all([closedWith(onA.ws), closedWith(member.ws)]);
  await setBoardEmbeddable(a.id, owner.id, false);
  expect(await aClosed).toEqual([4403, 4403]);
  const bClosed = closedWith(onB.ws);
  await updateWorkspace(team.id, owner.id, { policies: { boardEmbeds: 'off' } });
  expect(await bClosed).toBe(4403);
});

it('someone signed in from an embed gets their own access and no more — read-only when the embed asks — and the embed ends when they sign out', async () => {
  const owner = await person('Lead');
  const editor = await person('Dev');
  const stranger = await person('Stranger');
  const board = await createBoard(owner.id, 'Sprint', '', 'none');
  await inviteBoardMember(null, board.id, { ...owner, name: 'Lead', emailVerified: true } as never, { email: editor.email, role: 'editor' });
  await setBoardEmbeddable(board.id, owner.id, true);

  // Someone without access gets no token, so no embed acts for them.
  expect((await post(`/api/embed/b/${board.id}/token`, {}, stranger.cookie)).status).toBe(403);
  const readonly = (await (await post(`/api/embed/b/${board.id}/token`, { readonly: true }, editor.cookie)).json()) as { token: string };
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL, readonly.token])).role?.role).toBe('viewer');
  const full = (await (await post(`/api/embed/b/${board.id}/token`, {}, editor.cookie)).json()) as { token: string };
  // Until editing is started inside the frame the socket only reads; then it edits as the person.
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL, full.token, PUBLIC_EMBED_VIEW_ONLY])).role?.role).toBe('viewer');
  const editing = await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL, full.token]);
  expect(editing.role?.role).toBe('editor');
  // A token is for its board only.
  const elsewhere = await createBoard(editor.id, 'Mine', '', 'none');
  await setBoardEmbeddable(elsewhere.id, editor.id, true);
  expect((await connect(elsewhere.id, [PUBLIC_EMBED_WS_PROTOCOL, full.token])).closed).toBe(4403);

  const ended = closedWith(editing.ws);
  await endSessionsOf(editor.id);
  expect(await ended).toBe(4401);
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL, full.token])).closed).toBe(4401);
  expect((await post(`/api/embed/b/${board.id}/me`, { token: full.token })).status).toBe(401);
});

it('visitors beyond the per-board cap are turned away with their own close code, while people who signed in still connect', async () => {
  const owner = await person('Host');
  const board = await createBoard(owner.id, 'Town hall', '', 'viewer');
  await setBoardEmbeddable(board.id, owner.id, true);
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL])).role).toBeDefined();
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL])).role).toBeDefined();
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL])).closed).toBe(WS_CLOSE_EMBED_FULL);
  const { token } = (await (await post(`/api/embed/b/${board.id}/token`, {}, owner.cookie)).json()) as { token: string };
  expect((await connect(board.id, [PUBLIC_EMBED_WS_PROTOCOL, token])).role?.role).toBe('owner');
});

it('oEmbed answers only for embeddable boards of this server, names only public ones, and a title can’t put markup into the page it is pasted into', async () => {
  const owner = await person('Writer');
  const pub = await createBoard(owner.id, '"><script>alert(1)</script>', '', 'viewer');
  const priv = await createBoard(owner.id, 'Pay review', '', 'none');
  const off = await createBoard(owner.id, 'Drafts', '', 'viewer');
  await setBoardEmbeddable(pub.id, owner.id, true);
  await setBoardEmbeddable(priv.id, owner.id, true);
  const oembed = (url: string) => fetch(`${base}/api/oembed?format=json&url=${encodeURIComponent(url)}`);

  const res = await oembed(`${PUBLIC_URL}/board/${pub.id}?item=frame1`);
  expect(res.status).toBe(200);
  const body = (await res.json()) as OEmbedResponse;
  expect(body).toMatchObject({ version: '1.0', type: 'rich', title: '"><script>alert(1)</script>' });
  expect(body.html.match(/</g)).toHaveLength(2); // <iframe …></iframe> and no other tag
  expect(body.html).toContain(`src="${PUBLIC_URL}/embed/b/${pub.id}?frame=frame1"`);
  expect(((await (await oembed(`${PUBLIC_URL}/board/${priv.id}`)).json()) as OEmbedResponse).title).toBe('Freero board');
  expect((await oembed(`${PUBLIC_URL}/board/${off.id}`)).status).toBe(404);
  expect((await oembed(`https://elsewhere.test/board/${pub.id}`)).status).toBe(404);

  // Discovery: in a public board's page, for unfurlers that read only the HTML; never a private board's.
  expect(await (await fetch(`${base}/board/${pub.id}`)).text()).toContain('type="application/json+oembed"');
  expect(await (await fetch(`${base}/board/${priv.id}`)).text()).not.toContain('json+oembed');
});
