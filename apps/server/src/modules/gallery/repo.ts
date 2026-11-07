// The only writer of `gallery_templates` [S4].
import type { GalleryCategory, GalleryLicence, GalleryStatus } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

/** Collection name -> key -> JSON value (the cleaned content of a template). */
export type GalleryContent = Record<string, Record<string, unknown>>;

export interface GalleryRow {
  id: string;
  submittedBy: string;
  sourceBoardId: string | null;
  status: GalleryStatus;
  title: string;
  description: string;
  category: GalleryCategory;
  licence: GalleryLicence;
  author: string;
  items: number;
  statusNote: string;
  installs: number;
  createdAt: number;
  decidedAt: number | null;
  publishedAt: number | null;
}

interface Row {
  id: string;
  submitted_by: string;
  source_board_id: string | null;
  status: GalleryStatus;
  title: string;
  description: string;
  category: GalleryCategory;
  licence: GalleryLicence;
  author: string;
  items: number;
  status_note: string;
  installs: number;
  created_at: Date;
  decided_at: Date | null;
  published_at: Date | null;
}

const COLUMNS = 'id, submitted_by, source_board_id, status, title, description, category, licence, author, items, status_note, installs, created_at, decided_at, published_at';

const toRow = (r: Row): GalleryRow => ({
  id: r.id,
  submittedBy: r.submitted_by,
  sourceBoardId: r.source_board_id,
  status: r.status,
  title: r.title,
  description: r.description,
  category: r.category,
  licence: r.licence,
  author: r.author,
  items: r.items,
  statusNote: r.status_note,
  installs: r.installs,
  createdAt: r.created_at.getTime(),
  decidedAt: r.decided_at?.getTime() ?? null,
  publishedAt: r.published_at?.getTime() ?? null,
});

/**
 * Inserts a submission unless its submitter already has `max` waiting or live (counted under a
 * per-person lock, so parallel submissions can't overshoot). False: over the limit.
 */
export async function insertWithinLimit(r: GalleryRow, content: GalleryContent, previewSvg: string, max: number): Promise<boolean> {
  return tx(async () => {
    await query(`SELECT pg_advisory_xact_lock(hashtext('gallery.quota'), hashtext($1))`, [r.submittedBy]);
    const n = await one<{ n: number }>(`SELECT count(*)::int AS n FROM gallery_templates WHERE submitted_by = $1 AND status IN ('pending', 'approved')`, [r.submittedBy]);
    if ((n?.n ?? 0) >= max) return false;
    await query(
      `INSERT INTO gallery_templates (id, submitted_by, source_board_id, status, title, description, category, licence, author, items, content, preview_svg, status_note, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, '', $13)`,
      [r.id, r.submittedBy, r.sourceBoardId, r.status, r.title, r.description, r.category, r.licence, r.author, r.items, JSON.stringify(content), previewSvg, new Date(r.createdAt)],
    );
    return true;
  });
}

export async function get(id: string): Promise<GalleryRow | null> {
  const r = await one<Row>(`SELECT ${COLUMNS} FROM gallery_templates WHERE id = $1`, [id]);
  return r ? toRow(r) : null;
}

export async function getMany(ids: readonly string[]): Promise<GalleryRow[]> {
  if (!ids.length) return [];
  return (await query<Row>(`SELECT ${COLUMNS} FROM gallery_templates WHERE id = ANY($1::text[])`, [ids])).map(toRow);
}

export async function contentOf(id: string): Promise<GalleryContent | null> {
  const r = await one<{ content: GalleryContent | string }>('SELECT content FROM gallery_templates WHERE id = $1', [id]);
  if (!r) return null;
  return typeof r.content === 'string' ? (JSON.parse(r.content) as GalleryContent) : r.content;
}

export async function previewOf(id: string): Promise<string | null> {
  return (await one<{ preview_svg: string }>('SELECT preview_svg FROM gallery_templates WHERE id = $1', [id]))?.preview_svg ?? null;
}

/**
 * Approved templates, newest first, matching every word of `words` (title, description, author) and
 * `category`, except those of `exceptSubmitters`.
 */
export async function published(opts: { words: string[]; category: string | null; limit: number; exceptSubmitters: readonly string[] }): Promise<GalleryRow[]> {
  const params: unknown[] = [opts.category, opts.limit, opts.exceptSubmitters];
  const conds = opts.words.map((w) => {
    params.push(`%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    const p = `$${params.length}`;
    return `(title ILIKE ${p} OR description ILIKE ${p} OR author ILIKE ${p})`;
  });
  const rows = await query<Row>(
    `SELECT ${COLUMNS} FROM gallery_templates
     WHERE status = 'approved' AND ($1::text IS NULL OR category = $1) AND submitted_by <> ALL($3::text[]) ${conds.map((c) => `AND ${c}`).join(' ')}
     ORDER BY published_at DESC, id LIMIT $2`,
    params,
  );
  return rows.map(toRow);
}

export async function byStatus(status: GalleryStatus, limit: number): Promise<GalleryRow[]> {
  return (await query<Row>(`SELECT ${COLUMNS} FROM gallery_templates WHERE status = $1 ORDER BY created_at DESC LIMIT $2`, [status, limit])).map(toRow);
}

export async function ownedBy(userId: string): Promise<GalleryRow[]> {
  return (await query<Row>(`SELECT ${COLUMNS} FROM gallery_templates WHERE submitted_by = $1 ORDER BY created_at DESC`, [userId])).map(toRow);
}

export async function deleteOwn(id: string, userId: string): Promise<boolean> {
  return (await query<{ id: string }>('DELETE FROM gallery_templates WHERE id = $1 AND submitted_by = $2 RETURNING id', [id, userId])).length > 0;
}

/** Moves a template from one of `from` to `to` (the moderation decision); false when it wasn't in one of them. */
export async function transition(id: string, from: GalleryStatus[], to: GalleryStatus, note: string, now: number): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE gallery_templates SET status = $3, status_note = $4, decided_at = $5,
       published_at = CASE WHEN $3 = 'approved' THEN COALESCE(published_at, $5) ELSE published_at END
     WHERE id = $1 AND status = ANY($2::text[]) RETURNING id`,
    [id, from, to, note, new Date(now)],
  );
  return rows.length > 0;
}

export async function countInstall(id: string): Promise<void> {
  await query('UPDATE gallery_templates SET installs = installs + 1 WHERE id = $1', [id]);
}

/** Upload names the templates' content uses, restricted to `among` (the uploads sweep keeps them). */
export async function uploadMatches(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name FROM (SELECT regexp_matches(content::text, $1, 'g') AS m FROM gallery_templates) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}
