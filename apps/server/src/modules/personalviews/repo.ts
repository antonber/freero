// The only writer of `personal_views` (a person's own view settings on a board).
import { query } from '../../platform/db';

export interface PersonalViewRow {
  boardId: string;
  itemId: string;
  viewId: string;
  settings: Record<string, unknown>;
  updatedAt: number;
}

interface Raw {
  board_id: string;
  item_id: string;
  view_id: string;
  settings: Record<string, unknown> | string;
  updated_at: Date;
}

const toRow = (r: Raw): PersonalViewRow => ({
  boardId: r.board_id,
  itemId: r.item_id,
  viewId: r.view_id,
  settings: typeof r.settings === 'string' ? (JSON.parse(r.settings) as Record<string, unknown>) : r.settings,
  updatedAt: new Date(r.updated_at).getTime(),
});

const COLUMNS = 'board_id, item_id, view_id, settings, updated_at';

/** This person's settings on one board. */
export async function ofUserOnBoard(userId: string, boardId: string): Promise<PersonalViewRow[]> {
  return (await query<Raw>(`SELECT ${COLUMNS} FROM personal_views WHERE user_id = $1 AND board_id = $2 ORDER BY item_id, view_id`, [userId, boardId])).map(toRow);
}

/** Everything this person keeps (their data export). */
export async function ofUser(userId: string): Promise<PersonalViewRow[]> {
  return (await query<Raw>(`SELECT ${COLUMNS} FROM personal_views WHERE user_id = $1 ORDER BY board_id, item_id, view_id`, [userId])).map(toRow);
}

export async function upsert(userId: string, boardId: string, itemId: string, viewId: string, settings: Record<string, unknown>, at: number): Promise<void> {
  await query(
    `INSERT INTO personal_views (user_id, board_id, item_id, view_id, settings, updated_at) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (user_id, board_id, item_id, view_id) DO UPDATE SET settings = EXCLUDED.settings, updated_at = EXCLUDED.updated_at`,
    [userId, boardId, itemId, viewId, JSON.stringify(settings), new Date(at)],
  );
}

export async function remove(userId: string, boardId: string, itemId: string, viewId: string): Promise<void> {
  await query('DELETE FROM personal_views WHERE user_id = $1 AND board_id = $2 AND item_id = $3 AND view_id = $4', [userId, boardId, itemId, viewId]);
}
