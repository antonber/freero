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

// ---------------------------------------------------------------------------------------------
// Snapshots: version history (KAI-49) and its retention (KAI-72)
// ---------------------------------------------------------------------------------------------

export type SnapshotKind = 'auto' | 'named' | 'before-restore';

export interface SnapshotInfo {
  id: number;
  kind: SnapshotKind;
  name: string | null;
  createdAt: number;
  /** User id of whoever named it / restored (null: automatic, or the account was deleted). */
  createdBy: string | null;
  bytes: number;
}

interface SnapshotRow {
  id: number;
  kind: SnapshotKind;
  name: string | null;
  created_at: Date;
  created_by: string | null;
  bytes: number;
}
const SNAPSHOT_COLUMNS = 'id, kind, name, created_at, created_by, octet_length(state) AS bytes';
const toInfo = (r: SnapshotRow): SnapshotInfo => ({
  id: Number(r.id),
  kind: r.kind,
  name: r.name,
  createdAt: new Date(r.created_at).getTime(),
  createdBy: r.created_by,
  bytes: Number(r.bytes),
});

/** The board's snapshots, newest first. */
export async function listSnapshots(boardId: string): Promise<SnapshotInfo[]> {
  const rows = await query<SnapshotRow>(
    `SELECT ${SNAPSHOT_COLUMNS} FROM board_doc_snapshots WHERE board_id = $1 ORDER BY created_at DESC, id DESC`,
    [boardId],
  );
  return rows.map(toInfo);
}

/** One snapshot's full document state (null if it does not belong to the board). */
export async function loadSnapshot(boardId: string, snapshotId: number): Promise<Uint8Array | null> {
  const r = await one<{ state: Uint8Array }>(`SELECT state FROM board_doc_snapshots WHERE board_id = $1 AND id = $2`, [boardId, snapshotId]);
  return r ? toBytes(r.state) : null;
}

/** Keeps `state` as a version of the board (named, or the board just before a restore). */
export async function insertSnapshot(
  boardId: string,
  s: { state: Uint8Array; kind: SnapshotKind; name: string | null; createdBy: string | null },
  now: number,
): Promise<SnapshotInfo> {
  const r = await guard(boardId, () =>
    one<SnapshotRow>(
      `INSERT INTO board_doc_snapshots (board_id, state, created_at, kind, name, created_by) VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${SNAPSHOT_COLUMNS}`,
      [boardId, toBuffer(s.state), new Date(now), s.kind, s.name, s.createdBy],
    ),
  );
  return toInfo(r!);
}

/** Names (or renames) a snapshot, which also exempts it from pruning. Null: not on this board. */
export async function nameSnapshot(boardId: string, snapshotId: number, name: string): Promise<SnapshotInfo | null> {
  const r = await one<SnapshotRow>(
    `UPDATE board_doc_snapshots SET kind = 'named', name = $3 WHERE board_id = $1 AND id = $2 RETURNING ${SNAPSHOT_COLUMNS}`,
    [boardId, snapshotId, name],
  );
  return r ? toInfo(r) : null;
}

/** Runs `fn` in one transaction (see platform/db.ts `tx`). */
export function transaction<T>(fn: () => Promise<T>): Promise<T> {
  return tx(() => fn());
}

/**
 * Inside a transaction: true when this caller may prune snapshots now. Held until the transaction
 * ends; another instance asking meanwhile gets false (and skips that round).
 */
export async function tryLockSnapshotPrune(): Promise<boolean> {
  const r = await one<{ ok: boolean }>(`SELECT pg_try_advisory_xact_lock(hashtext('realtime.snapshot-prune'), 0) AS ok`);
  return r?.ok === true;
}

/** Boards (by id, after `afterBoardId`) with more than one snapshot that retention could remove. */
export async function boardsWithPrunableSnapshots(afterBoardId: string, limit: number): Promise<string[]> {
  const rows = await query<{ board_id: string }>(
    `SELECT board_id FROM board_doc_snapshots WHERE kind <> 'named' AND board_id > $1
     GROUP BY board_id HAVING count(*) > 1 ORDER BY board_id LIMIT $2`,
    [afterBoardId, limit],
  );
  return rows.map((r) => r.board_id);
}

/** Every snapshot of the board, without its state (what the retention rules look at). */
export async function snapshotTimeline(boardId: string): Promise<Array<{ id: number; kind: SnapshotKind; createdAt: number }>> {
  const rows = await query<{ id: number; kind: SnapshotKind; created_at: Date }>(
    `SELECT id, kind, created_at FROM board_doc_snapshots WHERE board_id = $1`,
    [boardId],
  );
  return rows.map((r) => ({ id: Number(r.id), kind: r.kind, createdAt: new Date(r.created_at).getTime() }));
}

/** Deletes these snapshots of the board, never a named one (named meanwhile); returns how many. */
export async function deleteSnapshots(boardId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await query<{ id: number }>(
    `DELETE FROM board_doc_snapshots WHERE board_id = $1 AND id = ANY($2::bigint[]) AND kind <> 'named' RETURNING id`,
    [boardId, ids],
  );
  return rows.length;
}
