// A person whose access to a board ends loses their open socket to it: also when the change lands
// while the socket is being admitted, when the refresh that should close it fails once, and when
// this instance never hears of the change. Real memberships, real sockets, in-memory Postgres.
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { WebSocket, WebSocketServer } from 'ws';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, getAccount } from '../auth/index';
import { createBoard, getBoardAccess, trashBoard } from '../boards/index';
import { inviteBoardMember, removeBoardMember, removeBoardMemberships } from '../members/index';
import { admitSocket, recheckBoardAccess } from './rooms';

/**
 * This user's sockets read their access through their own resolver (Admission.resolveRole, as an
 * embed's do) — the real role, but its next `times` reads fail, as in a database blip. (Boards and
 * realtime import each other, so a mock of boards' getBoardAccess would not reach rooms.ts.)
 */
const blip = { userId: '', times: 0 };
const flakyAccess = (boardId: string, userId: string) => async () => {
  if (blip.times > 0) {
    blip.times--;
    throw new Error('connection terminated unexpectedly');
  }
  return (await getBoardAccess(boardId, userId)).role;
};

let wss: WebSocketServer;
let url = '';
let n = 0;
/** What the next admission does after it read the member's access and before it returns. */
let duringAdmission: (() => Promise<void>) | null = null;

const person = async (name: string) =>
  getAccount((await createUser({ name, email: `${name.toLowerCase()}-${++n}@access.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id);

beforeAll(async () => {
  await openTestDb();
  wss = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await new Promise<void>((r) => wss.once('listening', () => r()));
  wss.on('connection', (ws, req) => {
    const [boardId, userId] = (req.url ?? '/').slice(1).split('/');
    void admitSocket(ws, `s-${userId}`, async () => {
      // As ws.ts does: read the access, then one more await before returning (authorNamesOf).
      const { role } = await getBoardAccess(boardId, userId);
      if (!role) return { code: 4403, reason: 'No access to this board' };
      if (duringAdmission) await duringAdmission();
      return {
        boardId,
        userId,
        role,
        sessionKey: `s-${userId}`,
        identity: { id: userId, name: 'Member', color: '#1C7ED6', avatarUrl: null },
        ...(userId === blip.userId ? { resolveRole: flakyAccess(boardId, userId) } : {}),
      };
    });
  });
  url = `ws://127.0.0.1:${(wss.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => wss.close(r));
  await new Promise((r) => setTimeout(r, 200));
  await closeTestDb();
});

/** A board owned by someone, with a member who is an editor on it. */
async function boardWithEditor(): Promise<{ boardId: string; ownerId: string; memberId: string }> {
  const owner = await person('Owner');
  const member = await person('Member');
  const board = await createBoard(owner.id, 'Access', '');
  await inviteBoardMember(null, board.id, owner, { email: member.email, role: 'editor' });
  return { boardId: board.id, ownerId: owner.id, memberId: member.id };
}

/** Opens the member's socket, runs `afterOpen` once it is in, and resolves with its close code ('open': still open after `ms`). */
async function openAndWatch(boardId: string, userId: string, afterOpen: () => Promise<void>, ms = 1500): Promise<number | 'open'> {
  const socket = new WebSocket(`${url}/${boardId}/${userId}`);
  const closed = new Promise<number>((resolve) => socket.once('close', (code) => resolve(code)));
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  await new Promise((r) => setTimeout(r, 150)); // admitted (or refused)
  await afterOpen();
  const out = await Promise.race([closed, new Promise<'open'>((r) => setTimeout(() => r('open'), ms))]);
  socket.close();
  return out;
}

it('a member removed while their socket is being admitted is not let in with the role they had', async () => {
  const { boardId, ownerId, memberId } = await boardWithEditor();
  duringAdmission = () => removeBoardMember(boardId, ownerId, memberId);
  try {
    expect(await openAndWatch(boardId, memberId, async () => {})).toBe(4403);
  } finally {
    duringAdmission = null;
  }
});

it('a board trashed while a socket is being admitted does not let that socket into a fresh room', async () => {
  const { boardId, ownerId, memberId } = await boardWithEditor();
  duringAdmission = () => trashBoard(boardId, ownerId);
  try {
    expect(await openAndWatch(boardId, memberId, async () => {})).toBe(4403);
  } finally {
    duringAdmission = null;
  }
});

it('a removed member’s open socket is closed even when the access refresh hits a database error once', async () => {
  const { boardId, ownerId, memberId } = await boardWithEditor();
  blip.userId = memberId;
  const code = await openAndWatch(
    boardId,
    memberId,
    async () => {
      blip.times = 1; // the refresh's read of the member's access fails once
      await removeBoardMember(boardId, ownerId, memberId);
    },
    4000,
  );
  blip.userId = '';
  expect(code).toBe(4403);
});

it('a removed member’s open socket is closed even when this instance never heard of the removal', async () => {
  const { boardId, memberId } = await boardWithEditor();
  const code = await openAndWatch(boardId, memberId, async () => {
    // Removed through another instance whose announcement was lost (Redis gap): nothing here refreshes.
    await removeBoardMemberships([boardId], memberId);
    await recheckBoardAccess(); // the periodic re-check
  });
  expect(code).toBe(4403);
});
