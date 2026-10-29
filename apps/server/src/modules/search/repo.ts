// The only writer of `search_entries` and `search_sources` [S4].
import type { SearchHitKind } from '@freero/shared';
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';
import type { SearchRow } from './extract';

/**
 * Replaces the rows of one board with `rows`, derived at `version` — unless a derivation with a
 * higher version is already stored ('stale': nothing changes). 'gone': the board was deleted
 * meanwhile. One transaction under the source row's lock.
 */
export async function replaceEntries(boardId: string, version: number, rows: SearchRow[], now = Date.now()): Promise<'replaced' | 'stale' | 'gone'> {
  try {
    return await tx(async (t) => {
      const kept = await t.one<{ version: number }>(
        `INSERT INTO search_sources (board_id, version, derived_at) VALUES ($1, $2, $3)
         ON CONFLICT (board_id) DO UPDATE SET version = excluded.version, derived_at = excluded.derived_at
           WHERE search_sources.version <= excluded.version
         RETURNING version`,
        [boardId, version, new Date(now)],
      );
      if (!kept) return 'stale';
      await t.query(`DELETE FROM search_entries WHERE board_id = $1`, [boardId]);
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await t.query(
          `INSERT INTO search_entries (board_id, entry_key, kind, element_id, element_type, thread_id, body, version)
           SELECT $1, k, kd, e, et, th, b, $2 FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::text[]) AS u(k, kd, e, et, th, b)`,
          [
            boardId,
            version,
            chunk.map((r) => r.key),
            chunk.map((r) => r.kind),
            chunk.map((r) => r.elementId),
            chunk.map((r) => r.elementType),
            chunk.map((r) => r.threadId),
            chunk.map((r) => r.body),
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

export interface Match {
  boardId: string;
  key: string;
  kind: SearchHitKind;
  elementId: string | null;
  elementType: string | null;
  threadId: string | null;
  /** The text around the match, highlights between \u0001 and \u0002. */
  snippet: string;
}

interface MatchRow {
  board_id: string;
  entry_key: string;
  kind: SearchHitKind;
  element_id: string | null;
  element_type: string | null;
  thread_id: string | null;
  snippet: string;
}

const HEADLINE = 'StartSel=\u0001, StopSel=\u0002, MaxWords=30, MinWords=12, ShortWord=1, MaxFragments=1';

/**
 * The best matches of `tsquery` (a to_tsquery expression built from plain words) among the rows of
 * `boardIds`, best first; `offset` / `limit` page through them. A board's title ranks above the
 * same words in an item. Snippets are computed only for the page.
 */
export async function search(tsquery: string, boardIds: string[], limit: number, offset: number): Promise<Match[]> {
  if (!boardIds.length) return [];
  const rows = await query<MatchRow>(
    `WITH q AS (SELECT to_tsquery('simple', $1) AS q),
     page AS (
       SELECT e.board_id, e.entry_key, e.kind, e.element_id, e.element_type, e.thread_id, e.body,
              ts_rank(e.tsv, q.q) * (CASE e.kind WHEN 'board' THEN 3 ELSE 1 END) AS rank
       FROM search_entries e, q
       WHERE e.board_id = ANY($2::text[]) AND e.tsv @@ q.q
       ORDER BY rank DESC, e.board_id, e.entry_key
       LIMIT $3 OFFSET $4
     )
     SELECT p.board_id, p.entry_key, p.kind, p.element_id, p.element_type, p.thread_id,
            ts_headline('simple', p.body, q.q, $5) AS snippet
     FROM page p, q
     ORDER BY p.rank DESC, p.board_id, p.entry_key`,
    [tsquery, boardIds, limit, offset, HEADLINE],
  );
  return rows.map((r) => ({
    boardId: r.board_id,
    key: r.entry_key,
    kind: r.kind,
    elementId: r.element_id,
    elementType: r.element_type,
    threadId: r.thread_id,
    snippet: r.snippet,
  }));
}

/** One board's rows (tests, the rebuild's report). */
export async function entriesOf(boardId: string): Promise<Array<{ key: string; kind: SearchHitKind; body: string }>> {
  return (await query<{ entry_key: string; kind: SearchHitKind; body: string }>(`SELECT entry_key, kind, body FROM search_entries WHERE board_id = $1 ORDER BY entry_key`, [boardId])).map(
    (r) => ({ key: r.entry_key, kind: r.kind, body: r.body }),
  );
}

/** The version a board was last derived at, or null. */
export async function sourceVersion(boardId: string): Promise<number | null> {
  const r = await one<{ version: number }>(`SELECT version FROM search_sources WHERE board_id = $1`, [boardId]);
  return r ? Number(r.version) : null;
}

/** Drops the whole index (a rebuild starts from nothing). */
export async function clearAll(): Promise<void> {
  await tx(async (t) => {
    await t.query(`DELETE FROM search_entries`);
    await t.query(`DELETE FROM search_sources`);
  });
}
