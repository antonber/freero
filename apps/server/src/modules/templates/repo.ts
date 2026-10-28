// The only writer of `templates` [S4].
import type { SavedTemplate, SavedTemplateSummary, TemplateContent } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

interface Row {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  thumbnail: string | null;
  element_count: number;
  created_at: Date;
  updated_at: Date;
}

const SUMMARY_COLUMNS = 'id, owner_id, name, description, thumbnail, element_count, created_at, updated_at';

const toSummary = (r: Row): SavedTemplateSummary => ({
  id: r.id,
  ownerId: r.owner_id,
  name: r.name,
  description: r.description,
  thumbnail: r.thumbnail,
  elementCount: r.element_count,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

/**
 * THE visibility rule: which templates a user may list and insert. Personal for now. Workspaces
 * (KAI-37) widen this one predicate (owner OR shared with one of the user's workspaces); every
 * read below goes through it. `$1` is the user id.
 */
const VISIBLE_TO_USER = 'owner_id = $1';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function insertTemplate(t: SavedTemplate): Promise<void> {
  await query(
    `INSERT INTO templates (id, owner_id, name, description, thumbnail, content, element_count, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      t.id,
      t.ownerId,
      t.name,
      t.description,
      t.thumbnail,
      JSON.stringify(t.content),
      t.elementCount,
      new Date(t.createdAt),
      new Date(t.updatedAt),
    ],
  );
}

/** Templates the user may see, newest first (without their content). */
export async function listVisibleTo(userId: string): Promise<SavedTemplateSummary[]> {
  return (
    await query<Row>(`SELECT ${SUMMARY_COLUMNS} FROM templates WHERE ${VISIBLE_TO_USER} ORDER BY updated_at DESC, id`, [userId])
  ).map(toSummary);
}

/** One template with its content, or null if missing or not visible to the user. */
export async function getVisible(id: string, userId: string): Promise<SavedTemplate | null> {
  const r = await one<Row & { content: TemplateContent | string }>(
    `SELECT ${SUMMARY_COLUMNS}, content FROM templates WHERE ${VISIBLE_TO_USER} AND id = $2`,
    [userId, id],
  );
  if (!r) return null;
  return { ...toSummary(r), content: typeof r.content === 'string' ? (JSON.parse(r.content) as TemplateContent) : r.content };
}

export async function countOwnedBy(ownerId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM templates WHERE owner_id = $1`, [ownerId]);
  return r?.n ?? 0;
}

/** Inside `transaction()`: serializes quota-checked saves of one owner until the transaction ends. */
export async function lockOwnerQuota(ownerId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('templates.quota'), hashtext($1))`, [ownerId]);
}

/** Deletes the owner's template; returns its thumbnail (to delete the file), or undefined if none was deleted. */
export async function deleteOwned(id: string, ownerId: string): Promise<string | null | undefined> {
  const r = await one<{ thumbnail: string | null }>(`DELETE FROM templates WHERE id = $1 AND owner_id = $2 RETURNING thumbnail`, [
    id,
    ownerId,
  ]);
  return r ? r.thumbnail : undefined;
}

/** Every match of `pattern`'s first group in any template's content or thumbnail (restricted to `among` when given). */
export async function matchesInTemplates(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name
     FROM (SELECT regexp_matches(content::text || ' ' || COALESCE(thumbnail, ''), $1, 'g') AS m FROM templates) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}
