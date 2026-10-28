// The only writer of `board_docs`, `board_doc_updates`, `board_doc_snapshots`, `board_layers` and
// `board_layer_updates` [S4].
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

// ---- Board layers (layers.ts): one base + log per (board, layer), stored like the board doc ----

export interface StoredLayer extends StoredDoc {
  layer: string;
}

/** Every layer of a board (base + log), in ONE statement for a consistent read. */
export async function loadLayers(boardId: string, onlyLayer?: string): Promise<StoredLayer[]> {
  const rows = await query<{ part: number; layer: string; id: number; data: Uint8Array }>(
    `SELECT 0 AS part, layer, version AS id, state AS data FROM board_layers WHERE board_id = $1 AND ($2::text IS NULL OR layer = $2)
     UNION ALL
     SELECT 1 AS part, layer, id, data FROM board_layer_updates WHERE board_id = $1 AND ($2::text IS NULL OR layer = $2)
     ORDER BY part, id`,
    [boardId, onlyLayer ?? null],
  );
  const byLayer = new Map<string, StoredLayer>();
  for (const r of rows) {
    let l = byLayer.get(r.layer);
    if (!l) byLayer.set(r.layer, (l = { layer: r.layer, base: null, version: 0, updates: [] }));
    if (r.part === 0) {
      l.base = toBytes(r.data);
      l.version = Number(r.id);
    } else l.updates.push({ id: Number(r.id), data: toBytes(r.data) });
  }
  return [...byLayer.values()];
}

export async function appendLayerUpdate(boardId: string, layer: string, update: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    query(`INSERT INTO board_layer_updates (board_id, layer, data, created_at) VALUES ($1, $2, $3, $4)`, [
      boardId,
      layer,
      toBuffer(update),
      new Date(now),
    ]),
  );
}

/** The whole content of a layer of a brand-new (or trashed) board: becomes its base. */
export async function saveInitialLayer(boardId: string, layer: string, state: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    query(
      `INSERT INTO board_layers (board_id, layer, state, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (board_id, layer) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at,
         version = board_layers.version + 1`,
      [boardId, layer, toBuffer(state), new Date(now)],
    ),
  );
}

/**
 * Like `compact` for a layer. `c.state === null` deletes the layer (it holds nothing, or its owner
 * lost access): the base row and exactly the folded rows. Rows appended since stay (they recreate
 * the layer). False when another compaction replaced the base meanwhile.
 */
export async function compactLayer(
  boardId: string,
  layer: string,
  c: { fromVersion: number; state: Uint8Array | null; folded: number[] },
  now: number,
): Promise<boolean> {
  return guard(boardId, () =>
    tx(async (t) => {
      await t.query(
        `INSERT INTO board_layers (board_id, layer, state, updated_at) VALUES ($1, $2, $3, $4) ON CONFLICT (board_id, layer) DO NOTHING`,
        [boardId, layer, EMPTY_UPDATE, new Date(now)],
      );
      const row = await t.one<{ version: number }>(`SELECT version FROM board_layers WHERE board_id = $1 AND layer = $2 FOR UPDATE`, [
        boardId,
        layer,
      ]);
      if (!row || Number(row.version) !== c.fromVersion) return false;
      if (c.state) {
        await t.query(`UPDATE board_layers SET state = $3, version = version + 1, updated_at = $4 WHERE board_id = $1 AND layer = $2`, [
          boardId,
          layer,
          toBuffer(c.state),
          new Date(now),
        ]);
      } else {
        await t.query(`DELETE FROM board_layers WHERE board_id = $1 AND layer = $2`, [boardId, layer]);
      }
      if (c.folded.length)
        await t.query(`DELETE FROM board_layer_updates WHERE board_id = $1 AND id = ANY($2::bigint[])`, [boardId, c.folded]);
      return true;
    }),
  );
}
