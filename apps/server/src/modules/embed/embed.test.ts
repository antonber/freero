// A live board view in an AI assistant (#89), over the real /ws/embed/boards socket with a real
// ticket: what the person reviews there follows THEIR role on the board, while the connection still
// caps what the view may write.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Request } from 'express';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { EMBED_WS_PROTOCOL, MCP_SCOPES, SUGGESTIONS_COLLECTION, WS_MESSAGE_LAYER, WS_MESSAGE_ROLE, type RoleMessage } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { attachWebSockets } from '../../platform/ws';
import { authenticate, createPersonalToken, mintEmbedTicket, redeemEmbedTicket, registerProtectedResource } from '../apiauth/index';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { proposeSuggestions } from '../realtime/index';
import embedWs from './ws';

let server: http.Server;
let ws: { close(): void };
let port = 0;
const sockets: WebSocket[] = [];

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: '100', PUBLIC_URL: 'http://freero.test' });
  registerProtectedResource('/mcp', 'Freero MCP server', { scopes: MCP_SCOPES, optInScopes: ['boards:write', 'comments:write'] });
  server = http.createServer();
  ws = attachWebSockets(server, [embedWs({} as ServerContext)]);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  port = (server.address() as AddressInfo).port;
});
afterAll(async () => {
  for (const s of sockets) s.close();
  ws.close();
  await new Promise((r) => server.close(r));
  await new Promise((r) => setTimeout(r, 300)); // rooms unload before the database closes
  await closeTestDb();
});

/** A live view for `userId` through a connection with the default read + suggest permissions. */
async function liveView(userId: string, boardId: string) {
  const { secret } = await createPersonalToken(userId, 'password', { name: 'Assistant', scopes: ['boards:read', 'boards:suggest'], expiresInDays: 1 });
  const cred = await authenticate({ headers: { authorization: `Bearer ${secret}` } } as unknown as Request, '/mcp');
  const { ticket } = await mintEmbedTicket(cred, boardId);
  const redeemed = await redeemEmbedTicket(ticket);
  if (!redeemed) throw new Error('the ticket was refused');
  return redeemed.token;
}

/**
 * Opens the view's socket the way the board page does: asks for both layers, and collects what
 * arrives. Resolves once the private layer answered — the server answers in order, so whatever it
 * sends of the editors layer, asked first, has arrived by then.
 */
function openView(token: string, boardId: string): Promise<{ role: RoleMessage; editors: Y.Doc }> {
  const editors = new Y.Doc();
  const priv = new Y.Doc();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/embed/boards/${boardId}`, [EMBED_WS_PROTOCOL, token]);
  sockets.push(socket);
  let role: RoleMessage | null = null;
  const ask = (wire: string, doc: Y.Doc) => {
    const e = encoding.createEncoder();
    encoding.writeVarUint(e, WS_MESSAGE_LAYER);
    encoding.writeVarString(e, wire);
    syncProtocol.writeSyncStep1(e, doc);
    socket.send(encoding.toUint8Array(e));
  };
  return new Promise((resolve, reject) => {
    socket.on('open', () => {
      ask('editors', editors);
      ask('private', priv);
    });
    socket.on('close', (code) => reject(new Error(`closed ${code}`)));
    socket.on('message', (data: Buffer) => {
      const d = decoding.createDecoder(new Uint8Array(data));
      const type = decoding.readVarUint(d);
      if (type === WS_MESSAGE_ROLE) role = JSON.parse(decoding.readVarString(d)) as RoleMessage;
      if (type !== WS_MESSAGE_LAYER) return;
      const wire = decoding.readVarString(d);
      const kind = decoding.readVarUint(d);
      if (kind === syncProtocol.messageYjsSyncStep2 || kind === syncProtocol.messageYjsUpdate) Y.applyUpdate(wire === 'editors' ? editors : priv, decoding.readVarUint8Array(d));
      if (wire === 'private' && kind === syncProtocol.messageYjsSyncStep2) resolve({ role: role!, editors });
    });
  });
}

it('a pending proposal shows in the live view of an owner whose connection may only read and suggest — still read-only — and never in a viewer’s', async () => {
  const owner = await createUser({ name: 'Maria', email: 'maria@embed.test.freero.app', password: 'password-123' }, { emailVerified: true });
  const viewer = await createUser({ name: 'Vic', email: 'vic@embed.test.freero.app', password: 'password-123' });
  const board = await createBoard(owner.id, 'Sprint retro', '');
  await inviteBoardMember(null, board.id, owner, { email: viewer.email, role: 'viewer' });
  await proposeSuggestions(board.id, { userId: owner.id, role: 'owner', name: 'Maria', via: { kind: 'token', id: 'tok', name: 'Claude' } }, { description: 'A theme' }, () => ({
    change: { create: [{ id: 'idea', type: 'sticky', x: 0, y: 0, w: 200, h: 200, rotation: 0, text: 'Release checklist', color: 'yellow' } as never] },
  }));

  const mine = await openView(await liveView(owner.id, board.id), board.id);
  expect(mine.role.role).toBe('viewer'); // the connection can't change boards: the view writes nothing
  expect(mine.role.readRole).toBe('owner');
  expect([...mine.editors.getMap(SUGGESTIONS_COLLECTION).values()]).toEqual([expect.objectContaining({ op: 'create', groupId: expect.any(String) })]);

  const theirs = await openView(await liveView(viewer.id, board.id), board.id);
  expect(theirs.role.readRole).toBeUndefined();
  expect(theirs.editors.getMap(SUGGESTIONS_COLLECTION).size).toBe(0);
});
