// Automatic versions of a board people keep open (KAI-82): taken on a timer while the room is
// live, not only when the log is compacted after everyone left. Real y-websocket client, real
// rooms, in-memory Postgres; the period is shortened to 300 ms.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { WS_MESSAGE_ROLE } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { listSnapshots, loadSnapshot } from './docStore';
import { admitSocket } from './rooms';

const EVERY_MS = 300;
let wss: WebSocketServer;
let url: string;
let userId: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond: () => Promise<boolean> | boolean, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(20);
  }
};

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: '200', FREERO_SNAPSHOT_EVERY_MS: String(EVERY_MS) });
  userId = (await createUser({ name: 'Keeper', email: 'keeper@test.freero.app', password: 'password-123' })).id;
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    void admitSocket(ws, 'session', async () => ({
      boardId: (req.url ?? '/').slice(1),
      userId,
      role: 'editor',
      sessionKey: 'session',
      identity: { id: userId, name: 'Keeper', color: '#1C7ED6', avatarUrl: null },
    }));
  });
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => wss.close(r));
  await sleep(600); // the room saves and unloads
  await closeTestDb();
});

it('a board kept open with light editing gets an automatic version every period, never two in one, and none while nothing changes', async () => {
  const boardId = (await createBoard(userId, 'Open all day', '')).id;
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, boardId, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
  provider.messageHandlers[WS_MESSAGE_ROLE] = () => {};
  await waitFor(() => provider.synced, 'the client to sync');
  const autos = async () => (await listSnapshots(boardId)).filter((s) => s.kind === 'auto').sort((a, b) => a.createdAt - b.createdAt);

  // One small edit every 100 ms; the socket stays connected, so the room never unloads (and the log
  // stays far below the compaction threshold).
  let n = 0;
  await waitFor(async () => {
    doc.getMap('elements').set('note', `edit ${++n}`);
    await sleep(100);
    return (await autos()).length >= 3;
  }, 'three automatic versions while the board is open');
  const lastEdit = n;

  const taken = await autos();
  for (let i = 1; i < taken.length; i++) expect(taken[i].createdAt - taken[i - 1].createdAt).toBeGreaterThanOrEqual(EVERY_MS);
  // Each is the board at that moment: a later one has later edits.
  const noteIn = async (id: number) => {
    const d = new Y.Doc();
    Y.applyUpdate(d, (await loadSnapshot(boardId, id))!);
    return Number(String(d.getMap('elements').get('note')).slice('edit '.length));
  };
  expect(await noteIn(taken[2].id)).toBeGreaterThan(await noteIn(taken[0].id));

  // Edits stopped: the last ones still get their version, then no more while nothing changes.
  await waitFor(async () => (await noteIn((await autos()).at(-1)!.id)) === lastEdit, 'a version with the last edit');
  const settled = (await autos()).length;
  await sleep(EVERY_MS * 4);
  expect((await autos()).length).toBe(settled);
  provider.destroy();
}, 30_000);
