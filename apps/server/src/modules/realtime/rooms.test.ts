// The doc load/save races that appeared when the database became async, driven with real
// y-websocket clients over real sockets against an in-memory Postgres.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { SUGGESTIONS_COLLECTION, WS_MESSAGE_ROLE, type BoardElement } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, trashBoard } from '../boards/index';
import { loadDoc } from './docStore';
import * as repo from './repo';
import { admitSocket, changeBoard, loadedRoomCount, proposeSuggestions, snapshotBoardLayer } from './rooms';

// Gates let a test hold a doc load or save "in flight" while clients come and go.
const gates = vi.hoisted(() => {
  const open = () => Promise.resolve();
  return { load: open(), save: open(), note: open(), failSaves: 0 };
});
function gate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}
vi.mock('./repo', async (importOriginal) => {
  const real = await importOriginal<typeof import('./repo')>();
  return {
    ...real,
    loadDoc: async (id: string) => {
      await gates.load;
      return real.loadDoc(id);
    },
    appendUpdate: async (id: string, update: Uint8Array, now: number) => {
      if (gates.failSaves > 0 && gates.failSaves--) throw new Error('connection terminated unexpectedly');
      await gates.save;
      return real.appendUpdate(id, update, now);
    },
    noteSuggestionAuthor: async (...args: Parameters<typeof real.noteSuggestionAuthor>) => {
      await gates.note;
      return real.noteSuggestionAuthor(...args);
    },
  };
});

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

function connect(boardId: string, offline?: Record<string, string>): { doc: Y.Doc; provider: WebsocketProvider } {
  const doc = new Y.Doc();
  for (const [k, v] of Object.entries(offline ?? {})) doc.getMap('elements').set(k, v);
  const provider = new WebsocketProvider(url, boardId, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });
  provider.messageHandlers[WS_MESSAGE_ROLE] = () => {}; // role messages: not under test here
  providers.push(provider);
  return { doc, provider };
}
const has = (doc: Y.Doc, ...keys: string[]) => keys.every((k) => doc.getMap('elements').has(k));

async function newBoard(stored?: Record<string, string>): Promise<string> {
  const board = await createBoard(userId, 'Race', '');
  if (stored) {
    const d = new Y.Doc();
    for (const [k, v] of Object.entries(stored)) d.getMap('elements').set(k, v);
    await repo.saveInitialState(board.id, Y.encodeStateAsUpdate(d), Date.now());
  }
  return board.id;
}

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: String(IDLE_MS) });
  userId = (await createUser({ name: 'Racer', email: 'racer@test.freero.app', password: 'password-123' })).id;
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    const boardId = (req.url ?? '/').slice(1);
    void admitSocket(ws, 'session', async () => ({
      boardId,
      userId,
      role: 'editor',
      sessionKey: 'session',
      identity: { id: userId, name: 'Racer', color: '#1C7ED6', avatarUrl: null },
    }));
  });
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

beforeEach(() => {
  gates.load = Promise.resolve();
  gates.save = Promise.resolve();
  gates.note = Promise.resolve();
  gates.failSaves = 0;
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await new Promise((r) => wss.close(r));
  await sleep(IDLE_MS * 3); // let rooms save and unload before the database closes
  await closeTestDb();
});

it('clients that connect while the board is still loading get the stored content, and what they sent meanwhile is kept', async () => {
  const boardId = await newBoard({ stored: 'from the database' });
  const load = gate();
  gates.load = load.promise;

  const a = connect(boardId, { offlineA: 'a' });
  const b = connect(boardId, { offlineB: 'b' });
  await waitFor(() => wss.clients.size >= 2, 'both sockets to be accepted');
  await sleep(100); // their first sync messages arrive while the load is still pending
  load.release();

  for (const c of [a, b]) await waitFor(() => has(c.doc, 'stored', 'offlineA', 'offlineB'), 'every client to have everything');
  for (const c of [a, b]) c.provider.destroy();
  await waitFor(() => loadedRoomCount() === 0, 'the room to unload');
  const saved = new Y.Doc();
  Y.applyUpdate(saved, (await loadDoc(boardId)).state!);
  expect([...saved.getMap('elements').keys()].sort()).toEqual(['offlineA', 'offlineB', 'stored']);
});

it('a client that opens the board while its idle doc is being saved and unloaded keeps the latest content', async () => {
  const boardId = await newBoard();
  const first = connect(boardId);
  await waitFor(() => first.provider.synced, 'the first client to sync');
  first.doc.getMap('elements').set('x1', 'first edit');
  await sleep(50);

  const save = gate();
  gates.save = save.promise;
  first.provider.destroy(); // last one out: the room saves (held) and its unload timer runs
  await sleep(IDLE_MS * 2);

  const second = connect(boardId);
  await waitFor(() => second.provider.synced, 'the second client to sync');
  save.release();
  await waitFor(() => has(second.doc, 'x1'), 'the second client to see the first edit');
  second.doc.getMap('elements').set('x2', 'second edit');
  await sleep(50);
  second.provider.destroy();
  await waitFor(() => loadedRoomCount() === 0, 'the room to unload');

  const third = connect(boardId);
  await waitFor(() => third.provider.synced && has(third.doc, 'x1', 'x2'), 'both edits after a reload');
});

it('an app’s proposal that lands while its board is being moved to the trash is kept with the board, never reported made and lost', async () => {
  const boardId = await newBoard();
  const owner = { userId, role: 'owner' as const };
  const sticky = (id: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text: id, color: 'yellow' }) as unknown as BoardElement;
  // An edit whose save failed once: the room holds it, to save again.
  gates.failSaves = 1;
  await changeBoard(boardId, owner, () => ({ change: { create: [sticky('a')] } }));

  // An app proposes; it has read the board and is about to write its proposal…
  const note = gate();
  gates.note = note.promise;
  const proposing = proposeSuggestions(boardId, owner, { author: { kind: 'app', name: 'Planner', userId, userName: 'Racer', credentialId: 'tok' }, description: 'Ideas' }, () => ({
    change: { create: [sticky('idea')] },
  }));
  await sleep(50);
  // …when the owner moves the board to the trash: closing the room saves what it holds (held).
  const save = gate();
  gates.save = save.promise;
  const trashing = trashBoard(boardId, userId);
  await sleep(200);
  note.release(); // the proposal is written while that save is in flight
  await sleep(50);
  save.release();

  await trashing;
  await proposing; // reported made…
  const stored = new Y.Doc();
  Y.applyUpdate(stored, (await snapshotBoardLayer(boardId, 'editors'))!);
  expect(stored.getMap(SUGGESTIONS_COLLECTION).size).toBe(1); // …and kept with the trashed board
});