// The only writer of `shape_packs` and `shape_pack_icons` [S4].
import type { IconNode } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

export interface StoredPack {
  id: string;
  workspaceId: string;
  name: string;
  createdBy: string | null;
  createdAt: number;
  chars: number;
}

export interface StoredIcon {
  packId: string;
  position: number;
  name: string;
  viewBox: string;
  art: 'mono' | 'color';
  nodes: IconNode[];
}

interface PackRow {
  id: string;
  workspace_id: string;
  name: string;
  created_by: string | null;
  created_at: Date;
  chars: number | string;
}
interface IconRow {
  pack_id: string;
  position: number;
  name: string;
  view_box: string;
  art: 'mono' | 'color';
  nodes: IconNode[] | string;
}

const toPack = (r: PackRow): StoredPack => ({
  id: r.id,
  workspaceId: r.workspace_id,
  name: r.name,
  createdBy: r.created_by,
  createdAt: r.created_at.getTime(),
  chars: Number(r.chars),
});
const toIcon = (r: IconRow): StoredIcon => ({
  packId: r.pack_id,
  position: r.position,
  name: r.name,
  viewBox: r.view_box,
  art: r.art,
  nodes: typeof r.nodes === 'string' ? (JSON.parse(r.nodes) as IconNode[]) : r.nodes,
});

export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

/** Serialises pack creation per workspace (its limits hold under concurrent uploads). */
export async function lockWorkspace(workspaceId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('shapepacks'), hashtext($1))`, [workspaceId]);
}

export async function packsIn(workspaceId: string): Promise<StoredPack[]> {
  const rows = await query<PackRow>('SELECT * FROM shape_packs WHERE workspace_id = $1 ORDER BY created_at, id', [workspaceId]);
  return rows.map(toPack);
}

export async function getPack(id: string): Promise<StoredPack | null> {
  const r = await one<PackRow>('SELECT * FROM shape_packs WHERE id = $1', [id]);
  return r ? toPack(r) : null;
}

export async function usage(workspaceId: string): Promise<{ packs: number; chars: number }> {
  const r = await one<{ n: string | number; chars: string | number | null }>('SELECT count(*) AS n, SUM(chars) AS chars FROM shape_packs WHERE workspace_id = $1', [workspaceId]);
  return { packs: Number(r?.n ?? 0), chars: Number(r?.chars ?? 0) };
}

export async function iconsOf(packIds: readonly string[]): Promise<StoredIcon[]> {
  if (!packIds.length) return [];
  const rows = await query<IconRow>('SELECT * FROM shape_pack_icons WHERE pack_id = ANY($1::text[]) ORDER BY pack_id, position', [packIds]);
  return rows.map(toIcon);
}

export async function insertPack(p: StoredPack, icons: ReadonlyArray<Omit<StoredIcon, 'packId'>>): Promise<void> {
  await query('INSERT INTO shape_packs (id, workspace_id, name, created_by, created_at, chars) VALUES ($1, $2, $3, $4, $5, $6)', [
    p.id,
    p.workspaceId,
    p.name,
    p.createdBy,
    new Date(p.createdAt),
    p.chars,
  ]);
  // In batches: one statement per icon would be 500 round trips.
  for (let i = 0; i < icons.length; i += 100) {
    const batch = icons.slice(i, i + 100);
    const values: unknown[] = [];
    const rows = batch.map((ic, j) => {
      values.push(p.id, ic.position, ic.name, ic.viewBox, ic.art, JSON.stringify(ic.nodes));
      const b = j * 6;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}::jsonb)`;
    });
    await query(`INSERT INTO shape_pack_icons (pack_id, position, name, view_box, art, nodes) VALUES ${rows.join(', ')}`, values);
  }
}

export async function renamePack(id: string, name: string): Promise<void> {
  await query('UPDATE shape_packs SET name = $2 WHERE id = $1', [id, name]);
}

export async function deletePack(id: string): Promise<void> {
  await query('DELETE FROM shape_packs WHERE id = $1', [id]);
}
