// The only writer of `object_references` and `reference_sources` [S4].
import type { ReferenceKind } from '@freero/shared';
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';
import type { ReferenceRow } from './extract';

/**
 * Replaces the references of one source board with `rows`, derived at `version` — unless a
 * derivation with a higher version is already stored (then nothing changes: 'stale'). 'gone':
 * the board was deleted meanwhile. One transaction under the source row's lock.
 */
export async function replaceReferences(boardId: string, version: number, rows: ReferenceRow[], now = Date.now()): Promise<'replaced' | 'stale' | 'gone'> {
  try {
    return await tx(async (t) => {
      const kept = await t.one<{ version: number }>(
        `INSERT INTO reference_sources (board_id, version, derived_at) VALUES ($1, $2, $3)
         ON CONFLICT (board_id) DO UPDATE SET version = excluded.version, derived_at = excluded.derived_at
           WHERE reference_sources.version <= excluded.version
         RETURNING version`,
        [boardId, version, new Date(now)],
      );
      if (!kept) return 'stale';
      await t.query(`DELETE FROM object_references WHERE board_id = $1`, [boardId]);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await t.query(
          `INSERT INTO object_references (board_id, source_element, source_type, target, target_board, kind, version)
           SELECT $1, s, st, tg, tb, k, $2 FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[]) AS u(s, st, tg, tb, k)`,
          [
            boardId,
            version,
            chunk.map((r) => r.sourceElement),
            chunk.map((r) => r.sourceType),
            chunk.map((r) => r.target),
            chunk.map((r) => r.targetBoard),
            chunk.map((r) => r.kind),
          ],
        );
      }
      return 'replaced';
    });
  } catch (e) {
    if (isForeignKeyViolation(e)) return 'gone';
    throw e;
  }
}

export interface StoredReference {
  boardId: string;
  sourceElement: string;
  sourceType: string | null;
  target: string;
  kind: ReferenceKind;
}

interface Row {
  board_id: string;
  source_element: string;
  source_type: string | null;
  target: string;
  kind: ReferenceKind;
}
const COLUMNS = 'board_id, source_element, source_type, target, kind';
const toRef = (r: Row): StoredReference => ({
  boardId: r.board_id,
  sourceElement: r.source_element,
  sourceType: r.source_type,
  target: r.target,
  kind: r.kind,
});

/** References pointing at `target` exactly (newest sources first), at most `limit`. */
export async function referencesTo(target: string, limit: number): Promise<StoredReference[]> {
  return (
    await query<Row>(
      `SELECT ${COLUMNS} FROM object_references WHERE target = $1 ORDER BY version DESC, board_id, source_element LIMIT $2`,
      [target, limit],
    )
  ).map(toRef);
}

/** References pointing at a board or anything on it, at most `limit`. */
export async function referencesToBoard(boardId: string, limit: number): Promise<StoredReference[]> {
  return (
    await query<Row>(
      `SELECT ${COLUMNS} FROM object_references WHERE target_board = $1 ORDER BY version DESC, board_id, source_element LIMIT $2`,
      [boardId, limit],
    )
  ).map(toRef);
}

/** Everything one board's content points at (tests, the rebuild's report). */
export async function referencesFrom(boardId: string): Promise<StoredReference[]> {
  return (
    await query<Row>(
      `SELECT ${COLUMNS} FROM object_references WHERE board_id = $1 ORDER BY source_element, target, kind`,
      [boardId],
    )
  ).map(toRef);
}

/** The version a source board was last derived at, or null. */
export async function sourceVersion(boardId: string): Promise<number | null> {
  const r = await one<{ version: number }>(`SELECT version FROM reference_sources WHERE board_id = $1`, [boardId]);
  return r ? Number(r.version) : null;
}

/** Drops the whole index (a rebuild starts from nothing). */
export async function clearAll(): Promise<void> {
  await tx(async (t) => {
    await t.query(`DELETE FROM object_references`);
    await t.query(`DELETE FROM reference_sources`);
  });
}
