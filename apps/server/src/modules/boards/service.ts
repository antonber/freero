import type { BoardSummary, LinkAccess, Role } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { getUser, getUsers } from '../auth/index';
import { atLeast, getMemberRole, membershipsOf, resolveRole } from '../members/index';
import { initBoardDoc, initBoardLayer, snapshotBoardDoc, snapshotBoardLayer } from '../realtime/index';
import * as repo from './repo';
import type { Board } from './repo';

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent';
export const BOARD_FILTERS: BoardFilter[] = ['all', 'mine', 'shared', 'starred', 'recent'];
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
  };
}

export async function listBoards(userId: string, filter: BoardFilter, q: string): Promise<BoardSummary[]> {
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

export async function createBoard(ownerId: string, title: string, description: string, linkAccess: LinkAccess = 'none'): Promise<Board> {
  const max = getConfig().maxBoardsPerUser;
  if ((await repo.boardIdsOwnedBy(ownerId)).length >= max)
    throw forbidden(`You have reached the limit of ${max} boards. Delete boards you no longer need to create new ones.`);
  const now = Date.now();
  const board: Board = { id: newId(10), title, description, ownerId, linkAccess, thumbnail: null, createdAt: now, updatedAt: now };
  await repo.insertBoard(board);
  return board;
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
