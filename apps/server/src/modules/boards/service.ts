import type { BoardSummary, LinkAccess, Role } from '@freero/shared';
import { badRequest, forbidden, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { getUser } from '../auth/index';
import { atLeast, getMemberRole, membershipsOf, resolveRole } from '../members/index';
import * as repo from './repo';
import type { Board } from './repo';

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent';
export const BOARD_FILTERS: BoardFilter[] = ['all', 'mine', 'shared', 'starred', 'recent'];
export const DEFAULT_TITLE = 'Untitled board';

export function roleOn(board: Board, userId: string): Role | null {
  return resolveRole(board, userId, getMemberRole(board.id, userId));
}

/** Loads a board and checks the user's role: 404 if missing, 403 if below `min`. */
export function requireAccess(boardId: string, userId: string, min: Role = 'viewer'): { board: Board; role: Role } {
  const board = repo.getBoard(boardId);
  if (!board) throw notFound('Board not found');
  const role = roleOn(board, userId);
  if (!role) throw forbidden();
  if (!atLeast(role, min)) throw forbidden(min === 'owner' ? 'Only the board owner can do that' : `You need ${min} access to do that`);
  return { board, role };
}

export function toSummary(
  board: Board,
  userId: string,
  role: Role,
  extra?: { starred?: boolean; lastOpenedAt?: number | null },
): BoardSummary {
  const starred = extra?.starred ?? repo.starredBoardIds(userId).has(board.id);
  const lastOpenedAt = extra && 'lastOpenedAt' in extra ? (extra.lastOpenedAt ?? null) : (repo.opensOf(userId).get(board.id) ?? null);
  return {
    id: board.id,
    title: board.title,
    description: board.description,
    ownerId: board.ownerId,
    ownerName: getUser(board.ownerId)?.name ?? 'Unknown',
    role,
    starred,
    thumbnail: board.thumbnail,
    linkAccess: board.linkAccess,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    lastOpenedAt,
  };
}

export function listBoards(userId: string, filter: BoardFilter, q: string): BoardSummary[] {
  const memberships = membershipsOf(userId);
  const opens = repo.opensOf(userId);
  const stars = repo.starredBoardIds(userId);
  const ids = new Set([...repo.boardIdsOwnedBy(userId), ...memberships.keys(), ...opens.keys(), ...stars]);
  const needle = q.trim().toLowerCase();

  const out: BoardSummary[] = [];
  for (const board of repo.getBoards([...ids])) {
    const role = resolveRole(board, userId, memberships.get(board.id) ?? null);
    if (!role) continue; // e.g. link access was revoked after the user opened it
    const s = toSummary(board, userId, role, { starred: stars.has(board.id), lastOpenedAt: opens.get(board.id) ?? null });
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

export function createBoard(ownerId: string, title: string, description: string, linkAccess: LinkAccess = 'none'): Board {
  const now = Date.now();
  const board: Board = { id: newId(10), title, description, ownerId, linkAccess, thumbnail: null, createdAt: now, updatedAt: now };
  repo.insertBoard(board);
  return board;
}
