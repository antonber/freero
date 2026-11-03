// The only writer of `templates` [S4].
import type { SavedTemplateSummary, TemplateContent } from '@freero/shared';
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
  organisation_id: string | null;
  locked: boolean | null;
  retired_at: Date | null;
}

const SUMMARY_COLUMNS = 'id, owner_id, name, description, thumbnail, workspace_id, element_count, created_at, updated_at, organisation_id, locked, retired_at';

/** A stored template's summary; `ownerName` / `canUnshare` depend on the reader (service.ts fills them). */
export type StoredSummary = Omit<SavedTemplateSummary, 'ownerName' | 'canUnshare' | 'organisationName' | 'canManage'>;
export type StoredTemplate = StoredSummary & { content: TemplateContent };

const toSummary = (r: Row): StoredSummary => ({
  id: r.id,
  ownerId: r.owner_id,
  workspaceId: r.workspace_id,
  name: r.name,
  description: r.description,
  thumbnail: r.thumbnail,
  elementCount: r.element_count,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
  organisationId: r.organisation_id ?? null,
  locked: r.locked === true,
  retiredAt: r.retired_at ? r.retired_at.getTime() : null,
});

/** Who reads (#155): their full-member team workspaces and those workspaces' organisations (from modules/workspaces). */
export interface Audience {
  workspaceIds: string[];
  organisationIds: string[];
}

/**
 * THE visibility rule: which templates a user may list and insert — their own, and those shared
 * with a team workspace they are a full member of. Every read below goes through it. `$1` is the
 * user id, `$2` the ids of the user's team workspaces where they are not a guest (from
 * modules/workspaces, so this module never reads another module's tables).
 */
// #155: a retired template reaches nobody but its owner; one published to an organisation reaches
// the full members of its attached workspaces ($3).
const VISIBLE_TO_USER = '(owner_id = $1 OR (retired_at IS NULL AND (workspace_id = ANY($2::text[]) OR organisation_id = ANY($3::text[]))))';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export async function insertTemplate(t: StoredTemplate): Promise<void> {
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
export async function listVisibleTo(userId: string, a: Audience): Promise<StoredSummary[]> {
  return (
    await query<Row>(`SELECT ${SUMMARY_COLUMNS} FROM templates WHERE ${VISIBLE_TO_USER} ORDER BY updated_at DESC, id`, [userId, a.workspaceIds, a.organisationIds])
  ).map(toSummary);
}

/** The templates among `ids` visible to the user (summaries; the object registry resolves through it). */
export async function visibleAmong(ids: string[], userId: string, a: Audience): Promise<StoredSummary[]> {
  if (!ids.length) return [];
  return (
    await query<Row>(`SELECT ${SUMMARY_COLUMNS} FROM templates WHERE ${VISIBLE_TO_USER} AND id = ANY($4::text[])`, [userId, a.workspaceIds, a.organisationIds, ids])
  ).map(toSummary);
}

/** One template with its content, or null if missing or not visible to the user. */
export async function getVisible(id: string, userId: string, a: Audience): Promise<StoredTemplate | null> {
  const r = await one<Row & { content: TemplateContent | string }>(
    `SELECT ${SUMMARY_COLUMNS}, content FROM templates WHERE ${VISIBLE_TO_USER} AND id = $4`,
    [userId, a.workspaceIds, a.organisationIds, id],
  );
  if (!r) return null;
  return { ...toSummary(r), content: typeof r.content === 'string' ? (JSON.parse(r.content) as TemplateContent) : r.content };
}

/** Templates with their content (data exports): the owner's, or those shared with a workspace. */
export async function fullTemplates(by: { ownerId: string } | { workspaceId: string }): Promise<StoredTemplate[]> {
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

/**
 * Shares the owner's template with a workspace (null: personal again). Null if it is not theirs,
 * or (#155) an admin locked it — then only an admin takes it back (`unshareFrom`).
 */
export async function setWorkspace(id: string, ownerId: string, workspaceId: string | null, now: number): Promise<StoredSummary | null> {
  const r = await one<Row>(
    `UPDATE templates SET workspace_id = $3, updated_at = $4 WHERE id = $1 AND owner_id = $2 AND (NOT locked OR workspace_id IS NOT DISTINCT FROM $3) RETURNING ${SUMMARY_COLUMNS}`,
    [id, ownerId, workspaceId, new Date(now)],
  );
  return r ? toSummary(r) : null;
}

/** One template whatever its sharing (#155: admins' actions check where it is shared themselves). */
export async function getSummary(id: string): Promise<StoredSummary | null> {
  const r = await one<Row>(`SELECT ${SUMMARY_COLUMNS} FROM templates WHERE id = $1`, [id]);
  return r ? toSummary(r) : null;
}

/** Publishes the owner's template to an organisation (null: takes it back; not while locked). Null if it isn't theirs or is locked. */
export async function setOrganisation(id: string, ownerId: string, organisationId: string | null, now: number): Promise<StoredSummary | null> {
  const r = await one<Row>(
    `UPDATE templates SET organisation_id = $3, published_by = CASE WHEN $3::text IS NULL THEN NULL ELSE $2 END, updated_at = $4,
       locked = CASE WHEN $3::text IS NULL THEN false ELSE locked END, retired_at = CASE WHEN $3::text IS NULL THEN NULL ELSE retired_at END
     WHERE id = $1 AND owner_id = $2 AND (NOT locked OR organisation_id IS NOT DISTINCT FROM $3) RETURNING ${SUMMARY_COLUMNS}`,
    [id, ownerId, organisationId, new Date(now)],
  );
  return r ? toSummary(r) : null;
}

/** An organisation's admin withdraws a template published to THEIR organisation. Null if it isn't published there. */
export async function unpublishFrom(id: string, organisationId: string, now: number): Promise<StoredSummary | null> {
  const r = await one<Row>(
    `UPDATE templates SET organisation_id = NULL, published_by = NULL, locked = false, retired_at = NULL, updated_at = $3
     WHERE id = $1 AND organisation_id = $2 RETURNING ${SUMMARY_COLUMNS}`,
    [id, organisationId, new Date(now)],
  );
  return r ? toSummary(r) : null;
}

/** Locks / unlocks, retires / brings back a template (the caller checked who may). */
export async function setAdminState(id: string, patch: { locked?: boolean; retiredAt?: number | null }, now: number): Promise<StoredSummary | null> {
  const r = await one<Row>(
    `UPDATE templates SET locked = COALESCE($2, locked), retired_at = CASE WHEN $3::boolean THEN $4::timestamptz ELSE retired_at END, updated_at = $5
     WHERE id = $1 RETURNING ${SUMMARY_COLUMNS}`,
    [id, patch.locked ?? null, patch.retiredAt !== undefined, patch.retiredAt == null ? null : new Date(patch.retiredAt), new Date(now)],
  );
  return r ? toSummary(r) : null;
}

/** What is shared with a workspace or published to an organisation, retired ones included (its admins). */
export async function sharedWithPlace(placeId: string): Promise<StoredSummary[]> {
  return (await query<Row>(`SELECT ${SUMMARY_COLUMNS} FROM templates WHERE workspace_id = $1 OR organisation_id = $1 ORDER BY updated_at DESC, id`, [placeId])).map(
    toSummary,
  );
}

/** A workspace admin stops a template being shared with THEIR workspace. Null if it isn't shared there (any more). */
export async function unshareFrom(id: string, workspaceId: string, now: number): Promise<StoredSummary | null> {
  const r = await one<Row>(
    `UPDATE templates SET workspace_id = NULL, updated_at = $3 WHERE id = $1 AND workspace_id = $2 RETURNING ${SUMMARY_COLUMNS}`,
    [id, workspaceId, new Date(now)],
  );
  return r ? toSummary(r) : null;
}

/** Everything `ownerId` shared with the workspace becomes personal again (they left it). */
export async function unshareAllOf(ownerId: string, workspaceId: string, now: number): Promise<number> {
  return (
    await query(`UPDATE templates SET workspace_id = NULL, updated_at = $3 WHERE owner_id = $1 AND workspace_id = $2 RETURNING 1`, [
      ownerId,
      workspaceId,
      new Date(now),
    ])
  ).length;
}

/** The workspace a template is shared with (null: personal), or undefined if there is no such template. */
export async function sharedWith(id: string): Promise<string | null | undefined> {
  const r = await one<{ workspace_id: string | null }>(`SELECT workspace_id FROM templates WHERE id = $1`, [id]);
  return r ? r.workspace_id : undefined;
}

/** Deletes the owner's template (#155: not while an admin locked it); returns its thumbnail (to delete the file), or undefined if none was deleted. */
export async function deleteOwned(id: string, ownerId: string): Promise<string | null | undefined> {
  const r = await one<{ thumbnail: string | null }>(`DELETE FROM templates WHERE id = $1 AND owner_id = $2 AND NOT locked RETURNING thumbnail`, [
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
