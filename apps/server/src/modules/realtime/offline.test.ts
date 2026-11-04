// Offline copies (#178): a device keeps a board's Yjs state, reloads it into a NEW doc (another
// client id) and reconnects later. Real y-websocket clients over real sockets: what each device
// changed offline reaches the board and the other device, and the server's role rules still apply
// to edits made while the person's access changed.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { WS_MESSAGE_ROLE, type Role } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { loadDoc } from './docStore';
import { loadedRoomCount, admitSocket } from './rooms';

const IDLE_MS = 100;
let wss: WebSocketServer;
let url = '';
/** The role each user's sockets are admitted with (changed between visits, like an owner would). */
const roles = new Map<string, Role>();
const names = new Map<string, string>();
const providers: WebsocketProvider[] = [];

const waitFor = async (cond: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sticky = (id: string, text: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, z: 1, color: '#FFE066', text });
const textOf = (doc: Y.Doc, id: string) => (doc.getMap('elements').get(id) as { text?: string } | undefined)?.text;

/** A device: a doc (fresh, or restored from the copy it kept) connected as `userId`. */
function device(boardId: string, userId: string, kept?: Uint8Array) {
  const doc = new Y.Doc();
  if (kept) Y.applyUpdate(doc, kept, 'load');
  const provider = new WebsocketProvider(url, boardId, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true, params: { user: userId } });
  provider.messageHandlers[WS_MESSAGE_ROLE] = () => {};
  providers.push(provider);
  return { doc, provider };
}
/** Goes offline: the socket closes, the device keeps its state (what the engine saves to IndexedDB). */
function goOffline(d: { doc: Y.Doc; provider: WebsocketProvider }): Uint8Array {
  d.provider.destroy();
  return Y.encodeStateAsUpdate(d.doc);
}
async function storedDoc(boardId: string): Promise<Y.Doc> {
  await waitFor(() => loadedRoomCount() === 0, 'the room to save and unload');
  const doc = new Y.Doc();
  Y.applyUpdate(doc, (await loadDoc(boardId)).state!);
  return doc;
}

async function person(name: string, role: Role): Promise<string> {
  const id = (await createUser({ name, email: `${name.toLowerCase()}@offline.test.freero.app`, password: 'password-123' })).id;
  roles.set(id, role);
  names.set(id, name);
  return id;
}

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: String(IDLE_MS) });
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    const u = new URL(req.url ?? '/', 'http://x');
    const boardId = u.pathname.slice(1);
    const userId = u.searchParams.get('user') ?? '';
    void admitSocket(ws, `s-${userId}`, async () => ({
      boardId,
      userId,
      role: roles.get(userId) ?? 'viewer',
      sessionKey: `s-${userId}`,
      identity: { id: userId, name: names.get(userId) ?? '?', color: '#1C7ED6', avatarUrl: null },
    }));
  });
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await new Promise((r) => wss.close(r));
  await sleep(IDLE_MS * 3);
  await closeTestDb();
});

it('edits two devices made offline from their kept copies (after a reload) both reach the board and each other on reconnect', async () => {
  const alice = await person('Alice', 'editor');
  const bob = await person('Bob', 'editor');
  const boardId = (await createBoard(alice, 'Train ride', '')).id;
  const first = device(boardId, alice);
  await waitFor(() => first.provider.synced, 'the board to sync');
  first.doc.getMap('elements').set('plan', sticky('plan', 'the plan'));
  const b0 = device(boardId, bob);
  await waitFor(() => b0.provider.synced && textOf(b0.doc, 'plan') === 'the plan', 'Bob to see the plan');

  // Both lose the network; each reloads the page from the copy on the device and keeps editing.
  const keptA = goOffline(first);
  const keptB = goOffline(b0);
  const offA = new Y.Doc();
  Y.applyUpdate(offA, keptA, 'load');
  offA.getMap('elements').set('a1', sticky('a1', 'added on the train'));
  const offB = new Y.Doc();
  Y.applyUpdate(offB, keptB, 'load');
  offB.getMap('elements').set('plan', sticky('plan', 'the plan, revised'));

  const a = device(boardId, alice, Y.encodeStateAsUpdate(offA));
  const b = device(boardId, bob, Y.encodeStateAsUpdate(offB));
  for (const d of [a, b])
    await waitFor(() => textOf(d.doc, 'a1') === 'added on the train' && textOf(d.doc, 'plan') === 'the plan, revised', 'both devices to hold both offline edits');
  a.provider.destroy();
  b.provider.destroy();
  const stored = await storedDoc(boardId);
  expect(textOf(stored, 'a1')).toBe('added on the train');
  expect(textOf(stored, 'plan')).toBe('the plan, revised');
});

it('someone made a viewer while offline: what their device changed meanwhile is refused on reconnect, and nobody else ever sees it', async () => {
  const owner = await person('Owner', 'owner');
  const carol = await person('Carol', 'editor');
  const boardId = (await createBoard(owner, 'Demoted', '')).id;
  const c0 = device(boardId, carol);
  await waitFor(() => c0.provider.synced, 'Carol to sync');
  c0.doc.getMap('elements').set('ok', sticky('ok', 'while an editor'));
  await sleep(100);
  const kept = goOffline(c0);

  roles.set(carol, 'viewer'); // the owner changes her role while she is away
  const off = new Y.Doc();
  Y.applyUpdate(off, kept, 'load');
  off.getMap('elements').set('late', sticky('late', 'written as a viewer'));
  const c = device(boardId, carol, Y.encodeStateAsUpdate(off));
  await waitFor(() => c.provider.synced, 'Carol to reconnect');
  await sleep(200);

  const o = device(boardId, owner);
  await waitFor(() => o.provider.synced && textOf(o.doc, 'ok') === 'while an editor', 'the owner to see what Carol wrote as an editor');
  await sleep(200);
  expect(o.doc.getMap('elements').has('late')).toBe(false);
  c.provider.destroy();
  o.provider.destroy();
  expect((await storedDoc(boardId)).getMap('elements').has('late')).toBe(false);
});
