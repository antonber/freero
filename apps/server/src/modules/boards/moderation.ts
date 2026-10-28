// What operators (modules/moderation) may do to a board, and what reporters may report. Moderation
// never writes `boards` itself [S4]: it calls these through boards' index. Each action is
// idempotent — false when the board already was in that state — so a retried or doubled request
// changes nothing twice.
import type { LinkAccess } from '@freero/shared';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { Board } from './repo';
import { closeKeepingContent, describeAccess, guestRoleFor } from './service';

export interface ModerationBoardState {
  id: string;
  title: string;
  ownerId: string;
  workspaceId: string;
  /** The owner's link setting (what restoring a blocked link brings back). */
  linkAccess: LinkAccess;
  linkBlocked: boolean;
  removedAt: number | null;
  deletedAt: number | null;
  thumbnail: string | null;
}

/** A board in any state (trashed, taken down) for the moderation queue; null when it is gone for good. */
export async function boardForModeration(boardId: string): Promise<ModerationBoardState | null> {
  const b = await repo.getBoardAnyState(boardId);
  if (!b) return null;
  return {
    id: b.id,
    title: b.title,
    ownerId: b.ownerId,
    workspaceId: b.workspaceId,
    linkAccess: b.storedLinkAccess,
    linkBlocked: b.linkBlocked,
    removedAt: b.removedAt,
    deletedAt: b.deletedAt,
    thumbnail: b.thumbnail,
  };
}

/**
 * The board, if `userId` (null: a visitor without an account, KAI-43) can open it and so may
 * report it or something on it; null otherwise — unknown, private, trashed and taken-down boards
 * alike, so reports can't be used to probe for boards. A visitor without an account can open
 * exactly what a guest may join (`guestRoleFor`: the link, the workspace's `publicLinks` policy).
 */
export async function reportableBoard(boardId: string, userId: string | null): Promise<{ id: string; title: string; ownerId: string } | null> {
  const board = await repo.getBoard(boardId);
  if (!board) return null;
  const role = userId ? (await describeAccess(board, userId)).role : await guestRoleFor(board);
  return role ? { id: board.id, title: board.title, ownerId: board.ownerId } : null;
}

/**
 * Takes the board down: it stops resolving for everyone (REST answers 451 to people who could open
 * it, 404 to everyone else; lists drop it) and every socket on every instance closes with
 * WS_CLOSE_BOARD_REMOVED. Its content, layers included, is kept exactly as it was for review.
 */
export async function takeDownBoard(boardId: string): Promise<boolean> {
  if (!(await repo.setRemoved(boardId, Date.now()))) return false;
  await closeKeepingContent(boardId, 'removed');
  return true;
}

/** Puts a taken-down board back in service, as it was. */
export function restoreTakenDownBoard(boardId: string): Promise<boolean> {
  return repo.setRemoved(boardId, null);
}

/**
 * Turns the board's link sharing off: people whose only access was the link lose it at once (their
 * sockets close on every instance); owners, members and the team keep theirs. The owner can't turn
 * it back on until it is restored.
 */
export async function blockBoardLink(boardId: string): Promise<boolean> {
  if (!(await repo.setLinkBlocked(boardId, Date.now()))) return false;
  await refreshBoardAccess(boardId);
  return true;
}

/** Lifts a link block: the link works again with the owner's setting. */
export async function unblockBoardLink(boardId: string): Promise<boolean> {
  if (!(await repo.setLinkBlocked(boardId, null))) return false;
  await refreshBoardAccess(boardId);
  return true;
}
