// Guest editing (#97, guestEditing.ts): a guest's real y-websocket client on the board socket, as a
// browser connects (its guest cookie through realtime's own route), against an in-memory Postgres.
// What it may not do must never land on the server — and the server must say so to its doc.
import type { IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import * as decoding from 'lib0/decoding';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { GUEST_EDIT_LIMITS, WS_MESSAGE_NOTICE, WS_MESSAGE_ROLE, type GuestEditNotice, type RoleMessage } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, startGuestSession } from '../auth/index';
import { createBoard, setBoardSharingSettings } from '../boards/index';
import { createTeamWorkspace, updateWorkspace } from '../workspaces/index';
import * as repo from './repo';
import { snapshotBoardDoc } from './rooms';
import realtimeWs from './ws';

let wss: WebSocketServer;
let url: string;
let ownerId: string;
const providers: WebsocketProvider[] = [];

const waitFor = async (cond: () => boolean | Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
};

const sticky = (id: string, createdBy: string, patch: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 1,
  rotation: 0,
  text: id,
  createdBy,
  ...patch,
});

/** A board with an "editor" link that lets guests edit, seeded with `elements`. */
async function board(elements: Record<string, unknown> = {}, place: { workspaceId?: string } = {}): Promise<string> {
  const b = await createBoard(ownerId, 'Workshop', '', 'editor', place);
  const d = new Y.Doc();
  for (const [k, v] of Object.entries(elements)) d.getMap('elements').set(k, v);
  await repo.saveInitialState(b.id, Y.encodeStateAsUpdate(d), Date.now());
  await setBoardSharingSettings(b.id, ownerId, { guestsCanEdit: true });
  return b.id;
}

/** A guest who joined `boardId` as `name`: its id and its browser's cookie. */
async function guest(boardId: string, name: string): Promise<{ id: string; cookie: string }> {
  let cookie = '';
  const req = { headers: {}, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' }, secure: false } as unknown as Request;
  const res = { cookie: (n: string, v: string) => void (cookie = `${n}=${v}`) } as unknown as Response;
  const info = await startGuestSession(req, res, boardId, name);
  return { id: info!.id, cookie };
}

/** The guest's browser on the board socket: its doc, what the server told it last, its notices. */
function open(boardId: string, cookie: string) {
  const doc = new Y.Doc();
  const seen: { role: RoleMessage | null; notices: GuestEditNotice[] } = { role: null, notices: [] };
  class WithCookie extends WebSocket {
    constructor(address: string, protocols?: string | string[]) {
      super(address, protocols, { headers: { cookie } });
    }
  }
  const provider = new WebsocketProvider(`${url}/ws/boards`, boardId, doc, { WebSocketPolyfill: WithCookie as unknown as typeof globalThis.WebSocket, disableBc: true });
  provider.messageHandlers[WS_MESSAGE_ROLE] = (_e, dec) => void (seen.role = JSON.parse(decoding.readVarString(dec)));
  provider.messageHandlers[WS_MESSAGE_NOTICE] = (_e, dec) => void seen.notices.push(JSON.parse(decoding.readVarString(dec)));
  providers.push(provider);
  return { doc, provider, seen, elements: doc.getMap<Record<string, unknown>>('elements') };
}

/** The board as the server holds it now. */
async function onServer(boardId: string): Promise<Record<string, Record<string, unknown>>> {
  const d = new Y.Doc();
  const state = await snapshotBoardDoc(boardId);
  if (state) Y.applyUpdate(d, state);
  return d.getMap('elements').toJSON();
}

async function editing(boardId: string, name = 'Kim') {
  const g = await guest(boardId, name);
  const c = open(boardId, g.cookie);
  await waitFor(() => c.provider.synced && !!c.seen.role?.guestEdit, 'the guest to sync as an editor');
  return { ...g, ...c };
}

beforeAll(async () => {
  const config = await openTestDb();
  ownerId = (await createUser({ name: 'Facilitator', email: 'fac@test.freero.app', password: 'password-123' }, { emailVerified: true })).id;
  const ctx: ServerContext = { config, onShutdown: () => {} };
  const route = realtimeWs(ctx).find((r) => r.prefix.startsWith('/ws/boards'))!;
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  wss.on('connection', (ws, req: IncomingMessage) => route.handle(ws, req));
  await new Promise((r) => wss.once('listening', r));
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const p of providers) p.destroy();
  await new Promise((r) => wss.close(r));
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

it("a guest editor's deletion of someone else's item never reaches the board, and its own client gets the item back", async () => {
  const boardId = await board({ o1: sticky('o1', ownerId) });
  const g = await editing(boardId);
  g.elements.delete('o1');
  await waitFor(() => g.elements.has('o1'), "the server to put the owner's sticky back on the guest's doc");
  expect(Object.keys(await onServer(boardId))).toContain('o1');
});

it('a guest editor cannot move or delete an item of its own once the owner protected it', async () => {
  const boardId = await board();
  const g = await guest(boardId, 'Kim');
  const seeded = new Y.Doc();
  seeded.getMap('elements').set('mine', sticky('mine', g.id, { locked: true, lockProtected: true }));
  await repo.saveInitialState(boardId, Y.encodeStateAsUpdate(seeded), Date.now());
  const c = open(boardId, g.cookie);
  await waitFor(() => c.provider.synced && !!c.seen.role?.guestEdit && c.elements.has('mine'), 'the guest to sync as an editor');
  c.elements.set('mine', { ...c.elements.get('mine')!, x: 500 });
  await waitFor(() => c.elements.get('mine')?.x === 0, 'the move to be undone on the guest');
  c.elements.delete('mine');
  await waitFor(() => c.elements.has('mine'), 'the deletion to be undone on the guest');
  expect((await onServer(boardId)).mine).toMatchObject({ x: 0, locked: true, lockProtected: true });
});

it("a guest editor past its hourly cap gets the extra items taken back, told why, and the board keeps only what the cap allows", async () => {
  const boardId = await board();
  const g = await editing(boardId);
  const over = GUEST_EDIT_LIMITS.itemsPerHour + 5;
  g.doc.transact(() => {
    for (let i = 0; i < over; i++) g.elements.set(`n${i}`, sticky(`n${i}`, g.id, { x: i * 10 }));
  });
  await waitFor(() => g.seen.notices.some((n) => n.code === 'hourly'), 'the guest to be told it reached the hourly cap');
  await waitFor(() => g.elements.size === GUEST_EDIT_LIMITS.itemsPerHour, "the guest's doc to converge on the cap");
  expect(Object.keys(await onServer(boardId))).toHaveLength(GUEST_EDIT_LIMITS.itemsPerHour);
});

it("what a guest editor adds is labelled with its name by the server, whoever its client names; its frames and writes to the board's settings are refused", async () => {
  const boardId = await board();
  const g = await editing(boardId);
  g.elements.set('ok', sticky('ok', ownerId, { guestName: 'Facilitator' }));
  await waitFor(async () => !!(await onServer(boardId)).ok, "the guest's sticky to land");
  g.elements.set('f1', { ...sticky('f1', g.id), type: 'frame' });
  await waitFor(() => !g.elements.has('f1'), "the guest's frame to be taken back");
  g.doc.getMap('settings').set('background', '#000000');
  await new Promise((r) => setTimeout(r, 300));
  const d = new Y.Doc();
  Y.applyUpdate(d, (await snapshotBoardDoc(boardId))!);
  expect(d.getMap('elements').get('ok')).toMatchObject({ createdBy: g.id, guestName: 'Kim' });
  expect(d.getMap('elements').has('f1')).toBe(false);
  expect(d.getMap('settings').get('background')).toBeUndefined();
});

it('turning guest editing off in the workspace makes a connected guest a commenter on its open socket: what it adds afterwards never lands', async () => {
  const team = await createTeamWorkspace(ownerId, 'Workshop team');
  const boardId = await board({}, { workspaceId: team.id });
  const g = await editing(boardId);
  await updateWorkspace(team.id, ownerId, { policies: { guestEditing: 'off' } });
  await waitFor(() => g.seen.role !== null && !g.seen.role.guestEdit, 'the open socket to be told the guest only comments now');
  expect(g.seen.role!.role).toBe('commenter');
  g.elements.set('late', sticky('late', g.id));
  await new Promise((r) => setTimeout(r, 300));
  expect(Object.keys(await onServer(boardId))).not.toContain('late');
});
