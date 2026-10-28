// changeBoard — the request-time write path (structure insertion; later the public API and MCP):
// collaborators receive it as one change, it is stamped for the actor, and it is saved.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { WS_MESSAGE_ROLE, type BoardElement, type ElementDraft } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { loadDoc } from './docStore';
import { admitSocket, changeBoard, initBoardDoc } from './rooms';

const IDLE_MS = 100;
let userId: string;
let wss: WebSocketServer;
let url: string;
const providers: WebsocketProvider[] = [];

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: String(IDLE_MS) });
  userId = (await createUser({ name: 'Writer', email: 'view@test.freero.app', password: 'password-123' })).id;
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    const boardId = (req.url ?? '/').slice(1);
    void admitSocket(ws, 'session', async () => ({ boardId, userId, role: 'editor', sessionKey: 'session', identity: { id: userId, name: 'W', color: '#1C7ED6', avatarUrl: null } }));
  });
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});
afterAll(async () => {
  for (const p of providers) p.destroy();
  await new Promise((r) => wss.close(r));
  await new Promise((r) => setTimeout(r, IDLE_MS * 3));
  await closeTestDb();
});

const waitFor = async (cond: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

const sticky = (id: string, x: number, z: number) =>
  ({ id, type: 'sticky', x, y: 0, w: 200, h: 200, rotation: 0, z, createdBy: 'someone', createdAt: 1, updatedAt: 1, text: id, color: 'yellow', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle' }) as BoardElement;

it('reaches connected collaborators as one change, stamped for the actor and above everything, and is saved', async () => {
  const boardId = (await createBoard(userId, 'View', '')).id;
  const seed = new Y.Doc();
  seed.getMap('elements').set('old', sticky('old', 0, 41));
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(seed));

  const doc = new Y.Doc();
  const provider = new WebsocketProvider(url, boardId, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
  provider.messageHandlers[WS_MESSAGE_ROLE] = () => {};
  providers.push(provider);
  await waitFor(() => provider.synced, 'the client to sync');
  let transactions = 0;
  doc.on('afterTransaction', (tr: Y.Transaction) => {
    if (tr.changed.size) transactions++;
  });

  const draft = (el: BoardElement) => {
    const { z: _z, createdBy: _c, createdAt: _t, updatedAt: _u, ...rest } = el;
    return rest as ElementDraft;
  };
  const { applied } = await changeBoard(boardId, { userId, role: 'editor' }, () => ({
    change: { create: [draft(sticky('a', 300, 0)), draft(sticky('b', 600, 0))], update: [{ id: 'old', patch: { x: 900 } }], collections: { tableCells: { 'k': 'v' } } },
  }));
  expect(applied).toEqual({ created: ['a', 'b'], updated: ['old'] });

  const els = doc.getMap<BoardElement>('elements');
  await waitFor(() => els.has('b') && els.get('old')!.x === 900, 'the change to arrive');
  await new Promise((r) => setTimeout(r, 100));
  expect(transactions).toBe(1);
  expect([els.get('a')!.z, els.get('b')!.z]).toEqual([42, 43]);
  expect(els.get('a')!.createdBy).toBe(userId);
  expect(doc.getMap('tableCells').get('k')).toBe('v');

  // Saved before changeBoard resolved.
  const stored = new Y.Doc();
  Y.applyUpdate(stored, (await loadDoc(boardId)).state!);
  expect([...stored.getMap('elements').keys()].sort()).toEqual(['a', 'b', 'old']);
});
