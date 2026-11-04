// Calls docked on the board (#149, callRoom.ts): a token for the operator's LiveKit server is minted
// only for someone who can open the board, and opens that board's room and no other.
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { boardCallToken, createBoard } from './index';

const SECRET = 'livekit-secret-for-tests-0123456789';

beforeAll(() => openTestDb({ LIVEKIT_URL: 'wss://media.example.com', LIVEKIT_API_KEY: 'APIkey', LIVEKIT_API_SECRET: SECRET }));
afterAll(() => closeTestDb());

/** The token's claims, after checking it is signed with the operator's API secret. */
function verified(token: string): Record<string, any> {
  const [head, body, sig] = token.split('.');
  expect(createHmac('sha256', SECRET).update(`${head}.${body}`).digest('base64url')).toBe(sig);
  return JSON.parse(Buffer.from(body, 'base64url').toString());
}

it('no call token for someone who cannot open the board — the same board with a link is joinable', async () => {
  const owner = await createUser({ name: 'Owner', email: 'calls-owner@test.freero.app', password: 'password-123' });
  const stranger = await createUser({ name: 'Stranger', email: 'calls-stranger@test.freero.app', password: 'password-123' });
  const board = await createBoard(owner.id, 'Private', '');
  await expect(boardCallToken(board.id, { id: stranger.id, name: stranger.name })).rejects.toMatchObject({ status: 403 });

  const open = await createBoard(owner.id, 'Open', '', 'viewer');
  const token = await boardCallToken(open.id, { id: stranger.id, name: stranger.name });
  expect(token.provider).toBe('livekit');
});

it("a call token's room is bound to its board: another board's token never names the same room", async () => {
  const owner = await createUser({ name: 'Host', email: 'calls-host@test.freero.app', password: 'password-123' });
  const a = await createBoard(owner.id, 'A', '');
  const b = await createBoard(owner.id, 'B', '');
  const ta = await boardCallToken(a.id, { id: owner.id, name: owner.name });
  const tb = await boardCallToken(b.id, { id: owner.id, name: owner.name });
  if (ta.provider !== 'livekit' || tb.provider !== 'livekit') throw new Error('LiveKit expected');
  const ca = verified(ta.token);
  const cb = verified(tb.token);
  expect(ca.video).toMatchObject({ room: ta.room, roomJoin: true });
  expect(ca.sub).toBe(owner.id);
  expect(cb.video.room).not.toBe(ca.video.room);
  // Neither room can be read off the board id.
  expect(ca.video.room).not.toContain(a.id);
});
