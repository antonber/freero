// Deciding a suggestion is first come, first served: when one editor rejects it while another
// accepts it, whichever decision reaches the server first stands and the other changes nothing —
// never a suggestion marked rejected whose change is on the board, nor one marked accepted whose
// change is not. Real sockets sending what Editor.acceptSuggestions / rejectSuggestions send: the
// decision in the editors layer and, for an accept, the board change in the shared doc (two
// messages: the layer one first, as BoardStore nests its transactions; the other way round when a
// reconnecting client sends what it did offline).
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import * as encoding from 'lib0/encoding';
import * as Y from 'yjs';
import { SUGGESTIONS_COLLECTION, WS_MESSAGE_LAYER, type BoardElement, type SuggestionRecord } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { admitSocket, changeBoard, MESSAGE_SYNC, proposeSuggestions, snapshotBoardDoc, snapshotBoardLayer } from './rooms';

// y-protocols sync message types: a live update, and the answer to a sync step 1 (what a client
// reconnecting sends of what it did offline).
const UPDATE = 2;
const STEP_2 = 1;
let wss: WebSocketServer;
let url = '';
let ownerId = '';
const owner = () => ({ userId: ownerId, role: 'owner' as const });

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: '100' });
  ownerId = (await createUser({ name: 'Owner', email: 'owner@suggestion-race.test.freero.app', password: 'password-123' })).id;
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  wss.on('connection', (ws, req) => {
    const [boardId, userId] = (req.url ?? '/').slice(1).split('/');
    void admitSocket(ws, `s-${userId}`, async () => ({
      boardId,
      userId,
      role: 'editor',
      sessionKey: `s-${userId}`,
      identity: { id: userId, name: userId, color: '#1C7ED6', avatarUrl: null },
    }));
  });
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => wss.close(r));
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

const sticky = (id: string, text: string) => ({ id, type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text, color: 'yellow' }) as unknown as BoardElement;
const settle = () => new Promise((r) => setTimeout(r, 250));

/** An editor's tab: a socket on the board and its copies of the shared doc and the editors layer. */
async function tab(boardId: string, userId: string) {
  const ws = new WebSocket(`${url}/${boardId}/${userId}`);
  await new Promise<void>((resolve, reject) => {
    ws.once('message', () => resolve()); // joined: the server sent the role
    ws.once('error', reject);
  });
  const copy = (state: Uint8Array | null) => {
    const d = new Y.Doc();
    if (state) Y.applyUpdate(d, state);
    return d;
  };
  const shared = copy(await snapshotBoardDoc(boardId));
  const editors = copy(await snapshotBoardLayer(boardId, 'editors'));
  const since = { shared: Y.encodeStateVector(shared), editors: Y.encodeStateVector(editors) };
  const sendShared = (type: number) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, MESSAGE_SYNC);
    encoding.writeVarUint(e, type);
    encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(shared, since.shared));
    ws.send(encoding.toUint8Array(e));
  };
  const sendLayer = (type = UPDATE) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE_LAYER);
    encoding.writeVarString(e, 'editors');
    encoding.writeVarUint(e, type);
    encoding.writeVarUint8Array(e, Y.encodeStateAsUpdate(editors, since.editors));
    ws.send(encoding.toUint8Array(e));
  };
  const records = () => [...editors.getMap<SuggestionRecord>(SUGGESTIONS_COLLECTION).values()];
  const decide = (status: 'accepted' | 'rejected') => {
    for (const r of records()) editors.getMap(SUGGESTIONS_COLLECTION).set(r.id, { ...r, decision: { status, by: userId, at: Date.now() } });
  };
  return {
    reject: () => {
      decide('rejected');
      sendLayer();
    },
    /** Editor.acceptSuggestions: the change and the decisions, sent live or, after reconnecting, from offline. */
    accept: (how: 'live' | 'from offline') => {
      const els = shared.getMap<unknown>('elements');
      for (const r of records()) {
        if (r.op === 'create') els.set(r.element!.id, { ...r.element, createdBy: userId, suggestedBy: { kind: r.author.kind, name: r.author.name, userId: r.author.userId } });
        if (r.op === 'update') els.set(r.targetId!, { ...(els.get(r.targetId!) as object), ...r.patch });
        if (r.op === 'delete') els.delete(r.targetId!);
      }
      decide('accepted');
      if (how === 'live') {
        sendLayer(); // BoardStore nests the editors layer's transaction innermost: it leaves first
        sendShared(UPDATE);
      } else {
        sendShared(STEP_2); // the server's sync step 1 for the shared doc comes first
        sendLayer(STEP_2);
      }
    },
    close: () => ws.close(),
  };
}

/** A board with two stickies and a pending proposal to add one, reword `t` and delete `d`. */
async function boardWithProposal(ops: Array<'create' | 'update' | 'delete'>) {
  const boardId = (await createBoard(ownerId, 'Race', '')).id;
  await changeBoard(boardId, owner(), () => ({ change: { create: [sticky('t', 'old words'), sticky('d', 'doomed')] } }));
  await proposeSuggestions(boardId, owner(), { description: 'Ideas' }, () => ({
    change: {
      ...(ops.includes('create') ? { create: [sticky('n1', 'new idea')] } : {}),
      ...(ops.includes('update') ? { update: [{ id: 't', patch: { text: 'new words' } }] } : {}),
      ...(ops.includes('delete') ? { remove: ['d'] } : {}),
    },
  }));
  return boardId;
}

/** Each suggestion's decision, and what the board says about each item it would change. */
async function outcome(boardId: string) {
  const shared = new Y.Doc();
  Y.applyUpdate(shared, (await snapshotBoardDoc(boardId))!);
  const editors = new Y.Doc();
  Y.applyUpdate(editors, (await snapshotBoardLayer(boardId, 'editors'))!);
  const els = shared.getMap<{ text?: string }>('elements');
  return {
    decisions: [...new Set([...editors.getMap<SuggestionRecord>(SUGGESTIONS_COLLECTION).values()].map((r) => r.decision?.status ?? 'pending'))],
    added: els.has('n1'),
    reworded: els.get('t')?.text === 'new words',
    deleted: !els.has('d'),
  };
}

it('an accept that reaches the server after a rejection of the same suggestion changes nothing on the board, live or sent from offline', async () => {
  const live = await boardWithProposal(['create', 'update', 'delete']);
  const [ann, bob] = [await tab(live, 'ann'), await tab(live, 'bob')];
  ann.reject();
  await settle();
  bob.accept('live');
  await settle();
  expect(await outcome(live)).toEqual({ decisions: ['rejected'], added: false, reworded: false, deleted: false });
  ann.close();
  bob.close();

  // Accepted offline, sent on reconnecting: the change arrives before the decision.
  const offline = await boardWithProposal(['create', 'update', 'delete']);
  const [cat, dan] = [await tab(offline, 'cat'), await tab(offline, 'dan')];
  cat.reject();
  await settle();
  dan.accept('from offline');
  await settle();
  expect(await outcome(offline)).toEqual({ decisions: ['rejected'], added: false, reworded: false, deleted: false });
  cat.close();
  dan.close();
});

it('a rejection that reaches the server after an accept of the same suggestion changes nothing', async () => {
  const boardId = await boardWithProposal(['create', 'update', 'delete']);
  const [ann, bob] = [await tab(boardId, 'ann'), await tab(boardId, 'bob')];
  bob.accept('live');
  await settle();
  ann.reject();
  await settle();
  expect(await outcome(boardId)).toEqual({ decisions: ['accepted'], added: true, reworded: true, deleted: true });
  ann.close();
  bob.close();
});
