// Public API of modules/boards [S2].
import type { Role } from '@freero/shared';
import { closeBoardDoc } from '../realtime/index';
import { deleteUpload, UPLOAD_REF_PATTERN } from '../uploads/index';
import * as repo from './repo';
import { requireAccess, roleOn } from './service';

export { createBoard } from './service';

/** The user's effective role on a board (`exists: false` when there is no such board). */
export async function getBoardAccess(
  boardId: string,
  userId: string,
): Promise<{ exists: boolean; role: Role | null; ownerId: string | null }> {
  const board = await repo.getBoard(boardId);
  if (!board) return { exists: false, role: null, ownerId: null };
  return { exists: true, role: await roleOn(board, userId), ownerId: board.ownerId };
}

/** Throws a 404/403 HttpError unless the user has at least `min` on the board. */
export async function requireBoardAccess(
  boardId: string,
  userId: string,
  min: Role = 'viewer',
): Promise<{ role: Role; ownerId: string; title: string }> {
  const { board, role } = await requireAccess(boardId, userId, min);
  return { role, ownerId: board.ownerId, title: board.title };
}

/** The board's title, or null if there is no such board (invite previews). */
export async function getBoardTitle(boardId: string): Promise<string | null> {
  return (await repo.getBoard(boardId))?.title ?? null;
}

/**
 * Account purge: deletes every board the user owns, like DELETE /boards/:id does (everyone is
 * disconnected first, then the row — members, stars, opens and doc cascade — then the thumbnail).
 */
export async function deleteBoardsOwnedBy(userId: string): Promise<number> {
  for (const id of await repo.allBoardIdsOwnedBy(userId)) await closeBoardDoc(id);
  const thumbnails = await repo.deleteAllOwnedBy(userId); // trashed ones too
  for (const t of thumbnails) await deleteUpload(t);
  return thumbnails.length;
}

/** Boards the user ever opened (they may have commented there). */
export async function boardIdsOpenedBy(userId: string): Promise<string[]> {
  return [...(await repo.opensOf(userId)).keys()];
}

/** Records that the board's content changed (called by realtime, throttled). */
export async function touchBoard(boardId: string, at = Date.now()): Promise<void> {
  await repo.touch(boardId, at);
}

/** Upload names used as board thumbnails (restricted to `among` when given): the uploads sweep keeps them. */
export function thumbnailUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.matchesInThumbnails(UPLOAD_REF_PATTERN, among ?? null);
}
