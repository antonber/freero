// The only writer of `templates` [S4].
import type { SavedTemplate, SavedTemplateSummary, TemplateContent } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

interface Row {
  id: string;
  owner_id: string;
  name: string;
  description: string;
  thumbnail: string | null;
  workspace_id: string | null;
  element_count: number;
  created_at: Date;
  updated_at: Date;
}

const SUMMARY_COLUMNS = 'id, owner_id, name, description, thumbnail, workspace_id, element_count, created_at, updated_at';

const toSummary = (r: Row): SavedTemplateSummary => ({
  id: r.id,
  ownerId: r.owner_id,
  workspaceId: r.workspace_id,
  name: r.name,
  description: r.description,
  thumbnail: r.thumbnail,
  elementCount: r.element_count,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

/**
 * THE visibility rule: which templates a user may list and insert — their own, and those shared
 * with a team workspace they are a full member of. Every read below goes through it. `$1` is the
 * user id, `$2` the ids of the user's team workspaces where they are not a guest (from
 * modules/workspaces, so this module never reads another module's tables).
 */
const VISIBLE_TO_USER = '(owner_id = $1 OR workspace_id = ANY($2::text[]))';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function insertTemplate(t: SavedTemplate): Promise<void> {
  await query(
    `INSERT INTO templates (id, owner_id, name, description, thumbnail, content, element_count, created_at, updated_at, workspace_id)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
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
      t.workspaceId,
    ],
  );
}

/** Templates the user may see, newest first (without their content). */
export async function listVisibleTo(userId: string, workspaceIds: string[]): Promise<SavedTemplateSummary[]> {
  return (
    await query<Row>(`SELECT ${SUMMARY_COLUMNS} FROM templates WHERE ${VISIBLE_TO_USER} ORDER BY updated_at DESC, id`, [userId, workspaceIds])
  ).map(toSummary);
}

/** One template with its content, or null if missing or not visible to the user. */
export async function getVisible(id: string, userId: string, workspaceIds: string[]): Promise<SavedTemplate | null> {
  const r = await one<Row & { content: TemplateContent | string }>(
    `SELECT ${SUMMARY_COLUMNS}, content FROM templates WHERE ${VISIBLE_TO_USER} AND id = $3`,
    [userId, workspaceIds, id],
  );
  if (!r) return null;
  return { ...toSummary(r), content: typeof r.content === 'string' ? (JSON.parse(r.content) as TemplateContent) : r.content };
}

/** Templates with their content (data exports): the owner's, or those shared with a workspace. */
export async function fullTemplates(by: { ownerId: string } | { workspaceId: string }): Promise<SavedTemplate[]> {
  const rows = await query<Row & { content: TemplateContent | string }>(
    `SELECT ${SUMMARY_COLUMNS}, content FROM templates WHERE ${'ownerId' in by ? 'owner_id' : 'workspace_id'} = $1 ORDER BY created_at, id`,
    ['ownerId' in by ? by.ownerId : by.workspaceId],
  );
  return rows.map((r) => ({ ...toSummary(r), content: typeof r.content === 'string' ? (JSON.parse(r.content) as TemplateContent) : r.content }));
}

export async function countOwnedBy(ownerId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM templates WHERE owner_id = $1`, [ownerId]);
  return r?.n ?? 0;
}

/** Inside `transaction()`: serializes quota-checked saves of one owner until the transaction ends. */
export async function lockOwnerQuota(ownerId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('templates.quota'), hashtext($1))`, [ownerId]);
}

/** Shares the owner's template with a workspace (null: personal again). Null if it is not theirs. */
export async function setWorkspace(id: string, ownerId: string, workspaceId: string | null, now: number): Promise<SavedTemplateSummary | null> {
  const r = await one<Row>(
    `UPDATE templates SET workspace_id = $3, updated_at = $4 WHERE id = $1 AND owner_id = $2 RETURNING ${SUMMARY_COLUMNS}`,
    [id, ownerId, workspaceId, new Date(now)],
  );
  return r ? toSummary(r) : null;
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
