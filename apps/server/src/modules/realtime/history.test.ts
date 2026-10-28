// Version history against real y-websocket clients and an in-memory Postgres: restoring is a live
// change everyone converges on, keeps social data, and can itself be undone.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { WS_MESSAGE_ROLE } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { loadDoc, loadSnapshot } from './docStore';
import { listVersions, nameCurrentVersion, restoreVersion } from './history';
import { admitSocket, loadedRoomCount } from './rooms';

const IDLE_MS = 100;
let wss: WebSocketServer;
let url: string;
let userId: string;
const providers: WebsocketProvider[] = [];

const waitFor = async (cond: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connect(boardId: string) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, boardId, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  provider.messageHandlers[WS_MESSAGE_ROLE] = () => {};
  providers.push(provider);
  return { doc, provider, els: doc.getMap<string>('elements'), comments: doc.getMap<string>('comments') };
}

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: String(IDLE_MS) });
  userId = (await createUser({ name: 'Historian', email: 'history@test.freero.app', password: 'password-123' })).id;
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    const boardId = (req.url ?? '/').slice(1);
    void admitSocket(ws, 'session', async () => ({
      boardId,
      userId,
      role: 'editor',
      sessionKey: 'session',
      identity: { id: userId, name: 'Historian', color: '#1C7ED6', avatarUrl: null },
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

it('restoring a version reaches every connected client, is saved, keeps comments, and restoring "before" undoes it', async () => {
  const boardId = (await createBoard(userId, 'History', '')).id;
  const a = connect(boardId);
  const b = connect(boardId);
  await waitFor(() => a.provider.synced && b.provider.synced, 'both clients to sync');

  a.els.set('keep', 'v1');
  a.els.set('edit', 'v1');
  await waitFor(() => b.els.get('edit') === 'v1', 'B to see v1');
  const v1 = await nameCurrentVersion(boardId, userId, 'Workshop start');

  // After the version: one item changed, one deleted, one added; a comment is posted.
  b.els.set('edit', 'v2');
  b.els.delete('keep');
  b.els.set('added', 'v2');
  b.comments.set('c1', 'a later comment');
  await waitFor(() => a.els.get('added') === 'v2' && a.comments.has('c1'), 'A to see the later edits');

  const before = await restoreVersion(boardId, v1.id, userId);
  const atV1 = (c: ReturnType<typeof connect>) =>
    c.els.get('keep') === 'v1' && c.els.get('edit') === 'v1' && !c.els.has('added') && c.comments.get('c1') === 'a later comment';
  await waitFor(() => atV1(a) && atV1(b), 'both clients to show v1 with the later comment still there');

  // Saved before the restore resolved: a fresh load of the database has it.
  const saved = new Y.Doc();
  Y.applyUpdate(saved, (await loadDoc(boardId)).state!);
  expect(saved.getMap('elements').toJSON()).toEqual({ keep: 'v1', edit: 'v1' });

  // The board just before the restore is a version; restoring it undoes the restore.
  expect(before.kind).toBe('before-restore');
  expect((await listVersions(boardId)).map((v) => v.id)).toContain(before.id);
  await restoreVersion(boardId, before.id, userId);
  const atV2 = (c: ReturnType<typeof connect>) => !c.els.has('keep') && c.els.get('edit') === 'v2' && c.els.get('added') === 'v2';
  await waitFor(() => atV2(a) && atV2(b), 'both clients to be back at the state before the restore');
  a.provider.destroy();
  b.provider.destroy();
});

it('naming the current version of a board nobody has open captures its stored content, and the room unloads again', async () => {
  const boardId = (await createBoard(userId, 'Closed', '')).id;
  const w = connect(boardId);
  await waitFor(() => w.provider.synced, 'sync');
  w.els.set('x', 'saved');
  await sleep(50);
  w.provider.destroy();
  await waitFor(() => loadedRoomCount() === 0, 'the board to unload');

  const v = await nameCurrentVersion(boardId, userId, 'Later');
  const state = new Y.Doc();
  Y.applyUpdate(state, (await loadSnapshot(boardId, v.id))!);
  expect(state.getMap('elements').get('x')).toBe('saved');
  await waitFor(() => loadedRoomCount() === 0, 'the room opened for the request to unload');
});
