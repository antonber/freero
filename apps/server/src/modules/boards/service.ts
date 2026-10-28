import { TRASH_RETENTION_DAYS, type BoardSummary, type LinkAccess, type Role } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { runExclusive } from '../../platform/jobs';
import { getUser, getUsers } from '../auth/index';
import { atLeast, getMemberRole, membershipsOf, resolveRole } from '../members/index';
import { closeBoardDoc, initBoardDoc, initBoardLayer, snapshotBoardDoc, snapshotBoardLayer, snapshotBoardLayers } from '../realtime/index';
import { deleteUpload } from '../uploads/index';
import * as repo from './repo';
import type { Board } from './repo';

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent' | 'trash';
export const BOARD_FILTERS: BoardFilter[] = ['all', 'mine', 'shared', 'starred', 'recent', 'trash'];
const DAY_MS = 86_400_000;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;
export const DEFAULT_TITLE = 'Untitled board';

export async function roleOn(board: Board, userId: string): Promise<Role | null> {
  return resolveRole(board, userId, await getMemberRole(board.id, userId));
}

/** Loads a board and checks the user's role: 404 if missing, 403 if below `min`. */
export async function requireAccess(boardId: string, userId: string, min: Role = 'viewer'): Promise<{ board: Board; role: Role }> {
  const board = await repo.getBoard(boardId);
  if (!board) throw notFound('Board not found');
  const role = await roleOn(board, userId);
  if (!role) throw forbidden();
  if (!atLeast(role, min)) throw forbidden(min === 'owner' ? 'Only the board owner can do that' : `You need ${min} access to do that`);
  return { board, role };
}

export async function toSummary(
  board: Board,
  userId: string,
  role: Role,
  extra?: { starred?: boolean; lastOpenedAt?: number | null; ownerName?: string },
): Promise<BoardSummary> {
  const starred = extra?.starred ?? (await repo.isStarred(board.id, userId));
  const lastOpenedAt =
    extra && 'lastOpenedAt' in extra ? (extra.lastOpenedAt ?? null) : await repo.lastOpenedAt(board.id, userId);
  const ownerName = extra?.ownerName ?? (await getUser(board.ownerId))?.name ?? 'Unknown';
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    ownerId: board.ownerId,
    ownerName,
    role,
    starred,
    thumbnail: board.thumbnail,
    linkAccess: board.linkAccess,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    lastOpenedAt,
    ...(board.deletedAt !== null ? { deletedAt: board.deletedAt, purgeAt: board.deletedAt + TRASH_RETENTION_MS } : {}),
  };
}

export async function listBoards(userId: string, filter: BoardFilter, q: string): Promise<BoardSummary[]> {
  if (filter === 'trash') return listTrash(userId, q);
  const [memberships, opens, stars, owned] = await Promise.all([
    membershipsOf(userId),
    repo.opensOf(userId),
    repo.starredBoardIds(userId),
    repo.boardIdsOwnedBy(userId),
  ]);
  const ids = new Set([...owned, ...memberships.keys(), ...opens.keys(), ...stars]);
  const needle = q.trim().toLowerCase();
  const boards = await repo.getBoards([...ids]);
  const owners = await getUsers(boards.map((b) => b.ownerId));

  const out: BoardSummary[] = [];
  for (const board of boards) {
    const role = resolveRole(board, userId, memberships.get(board.id) ?? null);
    if (!role) continue; // e.g. link access was revoked after the user opened it
    const s = await toSummary(board, userId, role, {
      starred: stars.has(board.id),
      lastOpenedAt: opens.get(board.id) ?? null,
      ownerName: owners.get(board.ownerId)?.name ?? 'Unknown',
    });
    if (filter === 'mine' && role !== 'owner') continue;
    if (filter === 'shared' && role === 'owner') continue;
    if (filter === 'starred' && !s.starred) continue;
    if (filter === 'recent' && s.lastOpenedAt === null) continue;
    if (needle && !s.title.toLowerCase().includes(needle)) continue;
    out.push(s);
  }
  if (filter === 'recent') out.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function cleanTitle(v: unknown, fallback = DEFAULT_TITLE): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw badRequest('title must be a string');
  const t = v.trim().slice(0, 200);
  return t || fallback;
}

export function cleanDescription(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest('description must be a string');
  return v.slice(0, 2000);
}

/**
 * Runs `write` (which adds one live board for `ownerId`) only if the owner is below the board
 * quota. The count and the write happen in one transaction under the owner's quota lock, so
 * concurrent creates/duplicates/restores of one user can never land over the limit (a plain
 * count-then-insert lets every parallel request pass the same count). Joins the caller's
 * transaction if there is one; the lock is then held until that one ends.
 */
function withinBoardQuota<T>(ownerId: string, refusal: (max: number) => string, write: () => Promise<T>): Promise<T> {
  return repo.transaction(async () => {
    const max = getConfig().maxBoardsPerUser;
    await repo.lockOwnerQuota(ownerId);
    if ((await repo.countLiveBoardsOwnedBy(ownerId)) >= max) throw forbidden(refusal(max));
    return write();
  });
}

export async function createBoard(ownerId: string, title: string, description: string, linkAccess: LinkAccess = 'none'): Promise<Board> {
  return withinBoardQuota(
    ownerId,
    (max) => `You have reached the limit of ${max} boards. Delete boards you no longer need to create new ones.`,
    async () => {
      const now = Date.now();
      const board: Board = {
        id: newId(10),
        title,
        description,
        ownerId,
        linkAccess,
        thumbnail: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      };
      await repo.insertBoard(board);
      return board;
    },
  );
}

// ---- trash ----

async function listTrash(userId: string, q: string): Promise<BoardSummary[]> {
  const needle = q.trim().toLowerCase();
  const [boards, me] = await Promise.all([repo.trashedBoardsOf(userId), getUser(userId)]);
  const out: BoardSummary[] = [];
  for (const b of boards) {
    if (needle && !b.title.toLowerCase().includes(needle)) continue;
    // Only owners see (and restore) trashed boards; stars/opens don't matter here.
    out.push(await toSummary(b, userId, 'owner', { starred: false, lastOpenedAt: null, ownerName: me?.name ?? 'Unknown' }));
  }
  return out;
}

/**
 * Moves a live board to the trash: it disappears from every list and stops resolving for access
 * (so new sockets are refused), and everyone connected is disconnected. Its content is kept
 * exactly as it was, including edits made in the last moments before the delete.
 */
export async function moveToTrash(board: Board, now = Date.now()): Promise<void> {
  if (!(await repo.trashBoard(board.id, now))) return; // trashed meanwhile by another request
  // The live doc may hold edits not saved yet (saves are debounced) and closing the room drops
  // them. Take the live state first, then close (which also waits for a save in flight), then
  // store that state last, so nothing older lands after it. Nobody can rejoin in between: the
  // board no longer resolves for access.
  // The same for its layers (hidden frames' contents, private drafts, sealed ballots): restoring
  // the board brings them back exactly as they were.
  const state = await snapshotBoardDoc(board.id);
  const layers = await snapshotBoardLayers(board.id);
  await closeBoardDoc(board.id);
  if (state) await initBoardDoc(board.id, state);
  for (const l of layers) await initBoardLayer(board.id, l.layer, l.state);
}

/** Owner only: takes a board out of the trash (subject to the board quota). */
export async function restoreFromTrash(boardId: string, userId: string): Promise<Board> {
  const board = await repo.getBoardIncludingTrash(boardId);
  // Not yours / not there: the same answer, so the trash leaks nothing about other people's boards.
  if (!board || board.deletedAt === null || board.ownerId !== userId) throw notFound('Board not found in your trash');
  await withinBoardQuota(
    userId,
    (max) => `You have reached the limit of ${max} boards. Delete boards you no longer need to restore this one.`,
    async () => {
      if (!(await repo.restoreBoard(board.id))) throw notFound('Board not found in your trash');
    },
  );
  return { ...board, deletedAt: null };
}

/** Owner only: deletes a trashed board and everything on it for good. */
export async function deleteForever(boardId: string, userId: string): Promise<void> {
  const board = await repo.getBoardIncludingTrash(boardId);
  if (!board || board.deletedAt === null || board.ownerId !== userId) throw notFound('Board not found in your trash');
  const thumbnail = await repo.deleteTrashedBoard(board.id);
  if (thumbnail === undefined) throw notFound('Board not found in your trash'); // restored or purged meanwhile
  await closeBoardDoc(board.id); // nobody should be connected; make sure nothing saves after the delete
  await deleteUpload(thumbnail);
}

const PURGE_BATCH = 200;

/** Advisory lock key of the trash purge (platform/jobs). */
export const TRASH_PURGE_LOCK_KEY = 7_202_610_282; // arbitrary, constant across releases

/**
 * Deletes for good every board that has been in the trash longer than TRASH_RETENTION_DAYS.
 * Idempotent and safe to run on every server instance at once: one instance purges (advisory
 * lock), the others skip this round (0). Returns how many boards this call removed.
 */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  return (await runExclusive(TRASH_PURGE_LOCK_KEY, () => purgeExpiredTrashLocked(now))) ?? 0;
}

/** The purge itself; the caller holds TRASH_PURGE_LOCK_KEY (purgeExpiredTrash or the scheduled job). */
export async function purgeExpiredTrashLocked(now = Date.now()): Promise<number> {
  const before = now - TRASH_RETENTION_MS;
  let total = 0;
  for (;;) {
    const purged = await repo.purgeTrashedBefore(before, PURGE_BATCH);
    for (const b of purged) {
      await closeBoardDoc(b.id);
      await deleteUpload(b.thumbnail);
    }
    total += purged.length;
    if (purged.length < PURGE_BATCH) break;
  }
  return total;
}

/**
 * A copy of `source` owned by `userId`, with the source's current content. The new board row and
 * its content are written in one transaction: if saving the content fails there is no empty copy.
 * Hidden frames' contents (the 'editors' layer) are copied only for someone who may see them
 * (`role` owner/editor); nobody's private layer (drafts, sealed ballots) is ever copied.
 */
export async function duplicateBoard(source: Board, userId: string, role: Role): Promise<Board> {
  // Read the content BEFORE the transaction: it may wait for the live doc to finish loading,
  // which queries the database outside this transaction.
  const state = await snapshotBoardDoc(source.id);
  const editors = atLeast(role, 'editor') ? await snapshotBoardLayer(source.id, 'editors') : null;
  return repo.transaction(async () => {
    const copy = await createBoard(userId, `Copy of ${source.title}`.slice(0, 200), source.description);
    if (state) await initBoardDoc(copy.id, state);
    if (editors) await initBoardLayer(copy.id, 'editors', editors);
    return copy;
  });
}
