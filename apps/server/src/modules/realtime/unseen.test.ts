// An operator on a board only its link opens to them (boards' visitsUnseen) is admitted `unseen`
// with `maxRole: 'viewer'`: real y-websocket clients over real sockets against an in-memory Postgres.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { WS_MESSAGE_ROLE } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { onBoardLeft } from './index';
import { admitSocket, snapshotBoardDoc } from './rooms';

let wss: WebSocketServer;
let url: string;
const people = { owner: '', operator: '' };
const providers: WebsocketProvider[] = [];
const left: string[] = [];

const waitFor = async (cond: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};

function connect(boardId: string, who: keyof typeof people) {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(`${url}/${who}`, boardId, doc, { WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket, disableBc: true });
  provider.messageHandlers[WS_MESSAGE_ROLE] = () => {};
  providers.push(provider);
  return { doc, provider };
}

beforeAll(async () => {
  await openTestDb();
  people.owner = (await createUser({ name: 'Owner', email: 'owner@unseen.test.freero.app', password: 'password-123' })).id;
  people.operator = (await createUser({ name: 'Operator', email: 'ops@unseen.test.freero.app', password: 'password-123' })).id;
  onBoardLeft((e) => void left.push(e.userId));
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req) => {
    const [, who, boardId] = (req.url ?? '').split('/') as [string, keyof typeof people, string];
    const unseen = who === 'operator';
    void admitSocket(ws, `session-${who}`, async () => ({
      boardId,
      userId: people[who],
      role: 'editor', // the board's link lets anyone edit
      sessionKey: `session-${who}`,
      identity: { id: people[who], name: who, color: '#1C7ED6', avatarUrl: null },
      ...(unseen ? { unseen: true, maxRole: 'viewer' as const } : {}),
    }));
  });
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await new Promise((r) => wss.close(r));
  await closeTestDb();
});

it('an unseen operator on a link-only board reads it live but nobody sees them there — no avatar or cursor — their edits never land, and leaving records no visit', async () => {
  const board = await createBoard(people.owner, 'Public plan', '', 'editor');
  const owner = connect(board.id, 'owner');
  const operator = connect(board.id, 'operator');
  await waitFor(() => owner.provider.synced && operator.provider.synced, 'both to sync');

  owner.provider.awareness.setLocalStateField('cursor', { x: 1, y: 1 });
  operator.provider.awareness.setLocalStateField('cursor', { x: 5, y: 5 });
  owner.doc.getMap('elements').set('o1', { id: 'o1', type: 'sticky', text: 'by the owner' });
  operator.doc.getMap('elements').set('x1', { id: 'x1', type: 'sticky', text: 'by the operator' });

  // The operator reads the owner live (their item and their cursor)…
  await waitFor(() => operator.doc.getMap('elements').has('o1'), 'the owner’s item to reach the operator');
  await waitFor(() => [...operator.provider.awareness.getStates().values()].some((s) => (s as { cursor?: unknown }).cursor !== undefined && s !== operator.provider.awareness.getLocalState()), 'the owner’s cursor to reach the operator');
  // …and once the server has everything the owner sent after it, the owner still sees only themself.
  owner.doc.getMap('elements').set('o2', { id: 'o2', type: 'sticky', text: 'barrier' });
  await waitFor(async () => {
    const d = new Y.Doc();
    const state = await snapshotBoardDoc(board.id);
    if (state) Y.applyUpdate(d, state);
    return d.getMap('elements').has('o2');
  }, 'the owner’s later item on the server');
  expect([...owner.provider.awareness.getStates().keys()]).toEqual([owner.doc.clientID]);
  const d = new Y.Doc();
  Y.applyUpdate(d, (await snapshotBoardDoc(board.id))!);
  expect(d.getMap('elements').has('x1')).toBe(false);
  expect(owner.doc.getMap('elements').has('x1')).toBe(false);

  operator.provider.destroy();
  owner.provider.destroy();
  await waitFor(() => left.includes(people.owner), 'the owner’s visit to be recorded');
  expect(left).not.toContain(people.operator);
});
