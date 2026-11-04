// The only writer of `blueprints` and `blueprint_items` [S3][S4].
import type { ObjectKind } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface Blueprint {
  id: string;
  ownerId: string;
  workspaceId: string | null;
  name: string;
  description: string;
  steps: string[];
  createdAt: number;
  updatedAt: number;
  items: Array<{ kind: ObjectKind; title: string }>;
}

export interface BlueprintItem {
  position: number;
  sourceId: string;
  kind: ObjectKind;
  title: string;
  description: string;
  state: Uint8Array | null;
}

interface Row {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  description: string;
  steps: unknown;
  created_at: Date;
  updated_at: Date;
  items: Array<{ kind: ObjectKind; title: string }> | null;
}

const toBlueprint = (r: Row): Blueprint => ({
  id: r.id,
  ownerId: r.owner_id,
  workspaceId: r.workspace_id,
  name: r.name,
  description: r.description,
  steps: Array.isArray(r.steps) ? r.steps.filter((s): s is string => typeof s === 'string') : [],
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
  items: r.items ?? [],
});

const SELECT = `SELECT b.*, (SELECT json_agg(json_build_object('kind', i.kind, 'title', i.title) ORDER BY i.position)
                  FROM blueprint_items i WHERE i.blueprint_id = b.id) AS items FROM blueprints b`;

/** Inside a transaction: the blueprint and its items, all or nothing. */
export async function insertBlueprint(b: Omit<Blueprint, 'items'>, items: BlueprintItem[]): Promise<void> {
  await query(
    `INSERT INTO blueprints (id, owner_id, workspace_id, name, description, steps, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
    [b.id, b.ownerId, b.workspaceId, b.name, b.description, JSON.stringify(b.steps), new Date(b.createdAt), new Date(b.updatedAt)],
  );
  for (const i of items)
    await query(`INSERT INTO blueprint_items (blueprint_id, position, source_id, kind, title, description, state) VALUES ($1, $2, $3, $4, $5, $6, $7)`, [
      b.id,
      i.position,
      i.sourceId,
      i.kind,
      i.title,
      i.description,
      i.state ? Buffer.from(i.state) : null,
    ]);
}

export async function getBlueprint(id: string): Promise<Blueprint | null> {
  const r = await one<Row>(`${SELECT} WHERE b.id = $1`, [id]);
  return r ? toBlueprint(r) : null;
}

/** The person's own blueprints and those shared with `workspaceIds`, newest change first. */
export async function visibleTo(userId: string, workspaceIds: string[]): Promise<Blueprint[]> {
  return (await query<Row>(`${SELECT} WHERE b.owner_id = $1 OR b.workspace_id = ANY($2::text[]) ORDER BY b.updated_at DESC, b.id`, [userId, workspaceIds])).map(toBlueprint);
}

export async function itemsOf(id: string): Promise<BlueprintItem[]> {
  const rows = await query<{ position: number; source_id: string; kind: ObjectKind; title: string; description: string; state: Buffer | null }>(
    `SELECT position, source_id, kind, title, description, state FROM blueprint_items WHERE blueprint_id = $1 ORDER BY position`,
    [id],
  );
  return rows.map((r) => ({ position: r.position, sourceId: r.source_id, kind: r.kind, title: r.title, description: r.description, state: r.state ? new Uint8Array(r.state) : null }));
}

export async function updateBlueprint(
  id: string,
  patch: { name?: string; description?: string; steps?: string[]; workspaceId?: string | null },
  now: number,
): Promise<boolean> {
  return (
    (await one(
      `UPDATE blueprints SET name = COALESCE($2, name), description = COALESCE($3, description), steps = COALESCE($4::jsonb, steps),
         workspace_id = CASE WHEN $5::boolean THEN $6 ELSE workspace_id END, updated_at = $7
       WHERE id = $1 RETURNING id`,
      [id, patch.name ?? null, patch.description ?? null, patch.steps ? JSON.stringify(patch.steps) : null, patch.workspaceId !== undefined, patch.workspaceId ?? null, new Date(now)],
    )) !== null
  );
}

export async function deleteBlueprint(id: string): Promise<boolean> {
  return (await one(`DELETE FROM blueprints WHERE id = $1 RETURNING id`, [id])) !== null;
}

/** Someone left a workspace (or became a guest): their blueprints shared there are theirs alone again. */
export async function unshareAllOf(ownerId: string, workspaceId: string, now: number): Promise<number> {
  return (await query(`UPDATE blueprints SET workspace_id = NULL, updated_at = $3 WHERE owner_id = $1 AND workspace_id = $2 RETURNING id`, [ownerId, workspaceId, new Date(now)])).length;
}

/** Upload names the items' content references (a blueprint outlives the boards it came from). */
export async function matchesInItems(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name FROM (SELECT regexp_matches(encode(state, 'escape'), $1, 'g') AS m FROM blueprint_items WHERE state IS NOT NULL) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}
