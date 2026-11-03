// The only writer of `sticker_sets` and `stickers` [S4].
import { one, query, tx } from '../../platform/db';

export interface StoredSet {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string | null;
  createdAt: number;
}

export interface StoredSticker {
  id: string;
  setId: string;
  name: string;
  uploadName: string;
  createdBy: string | null;
  createdAt: number;
}

interface SetRow {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string | null;
  created_at: Date;
}
interface StickerRow {
  id: string;
  set_id: string;
  name: string;
  upload_name: string;
  created_by: string | null;
  created_at: Date;
}

const toSet = (r: SetRow): StoredSet => ({ id: r.id, workspaceId: r.workspace_id, name: r.name, createdBy: r.created_by, createdAt: r.created_at.getTime() });
const toSticker = (r: StickerRow): StoredSticker => ({
  id: r.id,
  setId: r.set_id,
  name: r.name,
  uploadName: r.upload_name,
  createdBy: r.created_by,
  createdAt: r.created_at.getTime(),
});

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function setsIn(workspaceId: string): Promise<StoredSet[]> {
  const rows = await query<SetRow>('SELECT * FROM sticker_sets WHERE workspace_id = $1 ORDER BY created_at, id', [workspaceId]);
  return rows.map(toSet);
}

export async function getSet(id: string): Promise<StoredSet | null> {
  const r = await one<SetRow>('SELECT * FROM sticker_sets WHERE id = $1', [id]);
  return r ? toSet(r) : null;
}

/** Serialises set creation per workspace (the set limit holds under concurrent requests). */
export async function lockWorkspaceSets(workspaceId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('stickers.sets'), hashtext($1))`, [workspaceId]);
}

/** Serialises additions to one set (the sticker limit holds under concurrent uploads). */
export async function lockSet(setId: string): Promise<void> {
  await query('SELECT id FROM sticker_sets WHERE id = $1 FOR UPDATE', [setId]);
}

export async function countSets(workspaceId: string): Promise<number> {
  const r = await one<{ n: string }>('SELECT count(*) AS n FROM sticker_sets WHERE workspace_id = $1', [workspaceId]);
  return Number(r?.n ?? 0);
}

export async function insertSet(s: StoredSet): Promise<void> {
  await query('INSERT INTO sticker_sets (id, workspace_id, name, created_by, created_at) VALUES ($1, $2, $3, $4, $5)', [
    s.id,
    s.workspaceId,
    s.name,
    s.createdBy,
    new Date(s.createdAt),
  ]);
}

export async function deleteSet(id: string): Promise<void> {
  await query('DELETE FROM sticker_sets WHERE id = $1', [id]);
}

export async function stickersOf(setIds: readonly string[]): Promise<StoredSticker[]> {
  if (!setIds.length) return [];
  const rows = await query<StickerRow>('SELECT * FROM stickers WHERE set_id = ANY($1::text[]) ORDER BY created_at, id', [setIds]);
  return rows.map(toSticker);
}

export async function getSticker(setId: string, id: string): Promise<StoredSticker | null> {
  const r = await one<StickerRow>('SELECT * FROM stickers WHERE set_id = $1 AND id = $2', [setId, id]);
  return r ? toSticker(r) : null;
}

export async function countStickers(setId: string): Promise<number> {
  const r = await one<{ n: string }>('SELECT count(*) AS n FROM stickers WHERE set_id = $1', [setId]);
  return Number(r?.n ?? 0);
}

export async function insertSticker(s: StoredSticker): Promise<void> {
  await query('INSERT INTO stickers (id, set_id, name, upload_name, created_by, created_at) VALUES ($1, $2, $3, $4, $5, $6)', [
    s.id,
    s.setId,
    s.name,
    s.uploadName,
    s.createdBy,
    new Date(s.createdAt),
  ]);
}

export async function deleteSticker(setId: string, id: string): Promise<void> {
  await query('DELETE FROM stickers WHERE set_id = $1 AND id = $2', [setId, id]);
}

/** Upload names the stickers use, restricted to `among` when given (the uploads sweep). */
export async function uploadNames(among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ upload_name: string }>(
    'SELECT DISTINCT upload_name FROM stickers WHERE $1::text[] IS NULL OR upload_name = ANY($1::text[])',
    [among],
  );
  return rows.map((r) => r.upload_name);
}
