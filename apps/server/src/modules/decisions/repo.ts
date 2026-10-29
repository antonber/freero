// The only writer of `decisions` (KAI-161).
import { one, query } from '../../platform/db';

export interface DecisionRow {
  id: string;
  boardId: string;
  versionId: number;
  title: string;
  note: string;
  frameId: string | null;
  frameTitle: string | null;
  createdBy: string | null;
  createdAt: number;
}

interface Raw {
  id: string;
  board_id: string;
  version_id: number | string;
  title: string;
  note: string;
  frame_id: string | null;
  frame_title: string | null;
  created_by: string | null;
  created_at: Date;
}

const COLUMNS = 'id, board_id, version_id, title, note, frame_id, frame_title, created_by, created_at';
const toRow = (r: Raw): DecisionRow => ({
  id: r.id,
  boardId: r.board_id,
  versionId: Number(r.version_id),
  title: r.title,
  note: r.note,
  frameId: r.frame_id,
  frameTitle: r.frame_title,
  createdBy: r.created_by,
  createdAt: new Date(r.created_at).getTime(),
});

export async function insert(d: DecisionRow): Promise<void> {
  await query(
    `INSERT INTO decisions (${COLUMNS}) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [d.id, d.boardId, d.versionId, d.title, d.note, d.frameId, d.frameTitle, d.createdBy, new Date(d.createdAt)],
  );
}

export async function get(id: string): Promise<DecisionRow | null> {
  const r = await one<Raw>(`SELECT ${COLUMNS} FROM decisions WHERE id = $1`, [id]);
  return r ? toRow(r) : null;
}

export async function getMany(ids: readonly string[]): Promise<DecisionRow[]> {
  if (!ids.length) return [];
  return (await query<Raw>(`SELECT ${COLUMNS} FROM decisions WHERE id = ANY($1::text[])`, [ids])).map(toRow);
}

/** The board's decisions, newest first. */
export async function ofBoard(boardId: string): Promise<DecisionRow[]> {
  return (await query<Raw>(`SELECT ${COLUMNS} FROM decisions WHERE board_id = $1 ORDER BY created_at DESC, id`, [boardId])).map(toRow);
}

/** Decisions this person made (data export). */
export async function madeBy(userId: string): Promise<DecisionRow[]> {
  return (await query<Raw>(`SELECT ${COLUMNS} FROM decisions WHERE created_by = $1 ORDER BY created_at`, [userId])).map(toRow);
}

/** Deletes it; returns the row it was (null: already gone). */
export async function remove(id: string): Promise<DecisionRow | null> {
  const r = await one<Raw>(`DELETE FROM decisions WHERE id = $1 RETURNING ${COLUMNS}`, [id]);
  return r ? toRow(r) : null;
}
