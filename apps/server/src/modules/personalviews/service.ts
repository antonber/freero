// A person's own view settings on a board (docs/design/kanban-fields-and-views.md, decision 2):
// personal overrides of the views board items save for everyone (a kanban's board view). Anyone
// who can open the board keeps their own (viewers too: they never write the board); nobody reads
// anyone else's. The settings are opaque to the server (the board's features validate what they
// read), so all it checks is access, ids and size.
import type { PersonalViewEntry } from '@freero/shared';
import { badRequest, HttpError } from '../../platform/http';
import { requireBoardAccess } from '../boards/index';
import * as repo from './repo';

const ID = /^[A-Za-z0-9_-]{1,64}$/;
/** JSON size of one view's settings (the board's personal view state refuses bigger ones too). */
export const MAX_SETTINGS_BYTES = 4096;
/** Views one person keeps per board. */
export const MAX_VIEWS_PER_BOARD = 200;

export async function listPersonalViews(boardId: string, userId: string): Promise<PersonalViewEntry[]> {
  await requireBoardAccess(boardId, userId, 'viewer');
  return (await repo.ofUserOnBoard(userId, boardId)).map((r) => ({ itemId: r.itemId, viewId: r.viewId, settings: r.settings }));
}

/** Keeps (or with `settings` null, drops) this person's settings for one view of one item. */
export async function savePersonalView(boardId: string, userId: string, body: unknown): Promise<void> {
  await requireBoardAccess(boardId, userId, 'viewer');
  const b = (body ?? {}) as Record<string, unknown>;
  const itemId = typeof b.itemId === 'string' && ID.test(b.itemId) ? b.itemId : null;
  const viewId = typeof b.viewId === 'string' && ID.test(b.viewId) ? b.viewId : null;
  if (!itemId || !viewId) throw badRequest('itemId and viewId must be ids (letters, digits, - and _, at most 64)');
  if (b.settings === null) return repo.remove(userId, boardId, itemId, viewId);
  if (!b.settings || typeof b.settings !== 'object' || Array.isArray(b.settings)) throw badRequest('settings must be an object, or null to clear them');
  const settings = b.settings as Record<string, unknown>;
  if (JSON.stringify(settings).length > MAX_SETTINGS_BYTES) throw badRequest(`settings may be at most ${MAX_SETTINGS_BYTES} bytes`);
  const existing = await repo.ofUserOnBoard(userId, boardId);
  if (existing.length >= MAX_VIEWS_PER_BOARD && !existing.some((r) => r.itemId === itemId && r.viewId === viewId))
    throw new HttpError(409, `You keep your own settings for ${MAX_VIEWS_PER_BOARD} views on this board already; reset some to keep more`);
  await repo.upsert(userId, boardId, itemId, viewId, settings, Date.now());
}

/** Everything a person keeps here, for their data export. */
export async function personalViewsExportOf(userId: string): Promise<Array<PersonalViewEntry & { boardId: string; updatedAt: number }>> {
  return (await repo.ofUser(userId)).map((r) => ({ boardId: r.boardId, itemId: r.itemId, viewId: r.viewId, settings: r.settings, updatedAt: r.updatedAt }));
}
