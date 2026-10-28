// The only writer of `board_docs`, `board_doc_updates` and `board_doc_snapshots` [S4].
// A document = its compacted base (board_docs) + the update log written since (board_doc_updates).
// Yjs itself lives in docStore.ts; this file only moves bytes.
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';

const toBuffer = (u: Uint8Array) => Buffer.from(u.buffer, u.byteOffset, u.byteLength);
const toBytes = (b: Uint8Array) => new Uint8Array(b);
/** An empty Yjs update (no structs, empty delete set): the base of a board never compacted. */
const EMPTY_UPDATE = Buffer.from([0, 0]);

/** Thrown by writes when the board row is gone (deleted while its doc was open). */
export class BoardGoneError extends Error {}

async function guard<T>(boardId: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (isForeignKeyViolation(e)) throw new BoardGoneError(boardId);
    throw e;
  }
}

export interface StoredDoc {
  /** The compacted base, or null when the board has none yet. */
  base: Uint8Array | null;
  /** The base's version (0 without a base): what a compaction expects to replace. */
  version: number;
  /** Log rows written after the base was compacted, in id order. */
  updates: Array<{ id: number; data: Uint8Array }>;
}

/**
 * Base + log in ONE statement, so both come from the same snapshot of the database: a compaction
 * committing in between could otherwise move rows into a base this read no longer sees.
 */
export async function loadDoc(boardId: string): Promise<StoredDoc | null> {
  const rows = await query<{ part: number; id: number; data: Uint8Array }>(
    `SELECT 0 AS part, version AS id, state AS data FROM board_docs WHERE board_id = $1
     UNION ALL
     SELECT 1 AS part, id, data FROM board_doc_updates WHERE board_id = $1
     ORDER BY part, id`,
    [boardId],
  );
  if (!rows.length) return null;
  const base = rows[0].part === 0 ? rows[0] : null;
  return {
    base: base ? toBytes(base.data) : null,
    version: base ? Number(base.id) : 0,
    updates: rows.filter((r) => r.part === 1).map((r) => ({ id: Number(r.id), data: toBytes(r.data) })),
  };
}

/** Appends one update to the board's log. */
export async function appendUpdate(boardId: string, update: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    query(`INSERT INTO board_doc_updates (board_id, data, created_at) VALUES ($1, $2, $3)`, [boardId, toBuffer(update), new Date(now)]),
  );
}

/** The whole content of a brand-new board (a duplicate): becomes its base. */
export async function saveInitialState(boardId: string, state: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    query(
      `INSERT INTO board_docs (board_id, state, updated_at) VALUES ($1, $2, $3)
       ON CONFLICT (board_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at,
         version = board_docs.version + 1`,
      [boardId, toBuffer(state), new Date(now)],
    ),
  );
}

export interface Compaction {
  /** The base version the new state was folded from (StoredDoc.version). */
  fromVersion: number;
  /** Base + the folded rows, as one state. */
  state: Uint8Array;
  /** Ids of exactly the log rows folded into `state`. */
  folded: number[];
  /** Also keep `state` as a snapshot when the newest one is at least this old. */
  snapshotEveryMs: number;
}

/**
 * Replaces the base with `c.state` and deletes the folded rows, atomically. Rows appended since
 * the fold was read stay in the log. Returns false (and changes nothing) when another compaction
 * replaced the base meanwhile — overwriting it would drop the rows that one folded.
 */
export async function compact(boardId: string, c: Compaction, now: number): Promise<boolean> {
  return guard(boardId, () =>
    tx(async (t) => {
      // A board never compacted has no base row yet: create an empty one to lock (version 0).
      await t.query(`INSERT INTO board_docs (board_id, state, updated_at) VALUES ($1, $2, $3) ON CONFLICT (board_id) DO NOTHING`, [
        boardId,
        EMPTY_UPDATE,
        new Date(now),
      ]);
      const row = await t.one<{ version: number }>(`SELECT version FROM board_docs WHERE board_id = $1 FOR UPDATE`, [boardId]);
      if (!row || Number(row.version) !== c.fromVersion) return false;
      await t.query(`UPDATE board_docs SET state = $2, version = version + 1, updated_at = $3 WHERE board_id = $1`, [
        boardId,
        toBuffer(c.state),
        new Date(now),
      ]);
      if (c.folded.length)
        await t.query(`DELETE FROM board_doc_updates WHERE board_id = $1 AND id = ANY($2::bigint[])`, [boardId, c.folded]);
      const last = await t.one<{ at: Date | null }>(`SELECT max(created_at) AS at FROM board_doc_snapshots WHERE board_id = $1`, [boardId]);
      if (!last?.at || now - new Date(last.at).getTime() >= c.snapshotEveryMs)
        await t.query(`INSERT INTO board_doc_snapshots (board_id, state, created_at) VALUES ($1, $2, $3)`, [
          boardId,
          toBuffer(c.state),
          new Date(now),
        ]);
      return true;
    }),
  );
}

export interface SnapshotInfo {
  id: number;
  createdAt: number;
  bytes: number;
}

/** The board's snapshots, newest first. */
export async function listSnapshots(boardId: string): Promise<SnapshotInfo[]> {
  const rows = await query<{ id: number; created_at: Date; bytes: number }>(
    `SELECT id, created_at, octet_length(state) AS bytes FROM board_doc_snapshots WHERE board_id = $1 ORDER BY created_at DESC, id DESC`,
    [boardId],
  );
  return rows.map((r) => ({ id: Number(r.id), createdAt: new Date(r.created_at).getTime(), bytes: Number(r.bytes) }));
}

/** One snapshot's full document state (null if it does not belong to the board). */
export async function loadSnapshot(boardId: string, snapshotId: number): Promise<Uint8Array | null> {
  const r = await one<{ state: Uint8Array }>(`SELECT state FROM board_doc_snapshots WHERE board_id = $1 AND id = $2`, [boardId, snapshotId]);
  return r ? toBytes(r.state) : null;
}

/**
 * Every match of `pattern`'s first group in any stored document byte: bases, the update log and
 * version-history snapshots, of every board including trashed ones (restricted to `among` when
 * given). Yjs updates store element values as whole UTF-8 strings, and `encode(…, 'escape')`
 * keeps printable ASCII as is, so a URL in a document is found without decoding it in Node.
 */
export async function matchesInStoredDocs(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name FROM (
       SELECT regexp_matches(encode(state, 'escape'), $1, 'g') AS m FROM board_docs
       UNION ALL SELECT regexp_matches(encode(data, 'escape'), $1, 'g') FROM board_doc_updates
       UNION ALL SELECT regexp_matches(encode(state, 'escape'), $1, 'g') FROM board_doc_snapshots
     ) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}
