// The only writer of `board_docs`, `board_doc_updates`, `board_doc_snapshots`, `board_layers`,
// `board_layer_updates` and `board_suggestion_authors` [S4].
// A document = its compacted base (board_docs) + the update log written since (board_doc_updates).
// Yjs itself lives in docStore.ts; this file only moves bytes.
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';
import { appendOutbox } from '../../platform/outbox';
import { openStored, sealerFor, type BlobTable, type BoardSealer } from './sealing';

/**
 * Outbox topic of a board's shared content changing (key `board:<id>`), appended in the same
 * transaction as the saved change: derived indexes (references) recompute from the stored doc.
 * Private and editors layers never raise it — what they hold is not every reader's content.
 */
export const BOARD_CONTENT_TOPIC = 'board.content';
const contentChanged = (boardId: string) => appendOutbox(BOARD_CONTENT_TOPIC, `board:${boardId}`);

/** An empty Yjs update (no structs, empty delete set): the base of a board never compacted. */
const EMPTY_UPDATE = Buffer.from([0, 0]);

/** Keeps the upload names sealed rows of the board reference (#159), in the caller's transaction. */
async function keepSealedRefs(boardId: string, sealer: BoardSealer): Promise<void> {
  if (!sealer.refs.size) return;
  await query(`INSERT INTO board_sealed_refs (board_id, name) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`, [boardId, [...sealer.refs]]);
  sealer.refs.clear();
}

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
  const rows = await query<{ part: number; id: number; data: Uint8Array; sealed_with: string | null }>(
    `SELECT 0 AS part, version AS id, state AS data, sealed_with FROM board_docs WHERE board_id = $1
     UNION ALL
     SELECT 1 AS part, id, data, sealed_with FROM board_doc_updates WHERE board_id = $1
     ORDER BY part, id`,
    [boardId],
  );
  if (!rows.length) return null;
  const opened = await Promise.all(rows.map((r) => openStored(boardId, r.part === 0 ? 'doc' : 'update', r.data, r.sealed_with)));
  const base = rows[0].part === 0 ? rows[0] : null;
  return {
    base: base ? opened[0] : null,
    version: base ? Number(base.id) : 0,
    updates: rows.flatMap((r, i) => (r.part === 1 ? [{ id: Number(r.id), data: opened[i] }] : [])),
  };
}

/** Appends one update to the board's log. */
export async function appendUpdate(boardId: string, update: Uint8Array, now: number): Promise<void> {
  const sealer = await sealerFor(boardId);
  const row = sealer.seal('update', update);
  await guard(boardId, () =>
    tx(async () => {
      await query(`INSERT INTO board_doc_updates (board_id, data, created_at, sealed_with) VALUES ($1, $2, $3, $4)`, [boardId, row.data, new Date(now), row.sealedWith]);
      await keepSealedRefs(boardId, sealer);
      await contentChanged(boardId);
    }),
  );
}

/** The whole content of a brand-new board (a duplicate): becomes its base. */
export async function saveInitialState(boardId: string, state: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    tx(async () => {
      const sealer = await sealerFor(boardId);
      const row = sealer.seal('doc', state);
      await query(
        `INSERT INTO board_docs (board_id, state, updated_at, sealed_with) VALUES ($1, $2, $3, $4)
         ON CONFLICT (board_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at,
           version = board_docs.version + 1, sealed_with = excluded.sealed_with`,
        [boardId, row.data, new Date(now), row.sealedWith],
      );
      await keepSealedRefs(boardId, sealer);
      await contentChanged(boardId);
    }),
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
  const sealer = await sealerFor(boardId);
  const base = sealer.seal('doc', c.state);
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
      await t.query(`UPDATE board_docs SET state = $2, version = version + 1, updated_at = $3, sealed_with = $4 WHERE board_id = $1`, [
        boardId,
        base.data,
        new Date(now),
        base.sealedWith,
      ]);
      if (c.folded.length)
        await t.query(`DELETE FROM board_doc_updates WHERE board_id = $1 AND id = ANY($2::bigint[])`, [boardId, c.folded]);
      const last = await t.one<{ at: Date | null }>(`SELECT max(created_at) AS at FROM board_doc_snapshots WHERE board_id = $1`, [boardId]);
      if (!last?.at || now - new Date(last.at).getTime() >= c.snapshotEveryMs) {
        const snap = sealer.seal('snapshot', c.state);
        await t.query(`INSERT INTO board_doc_snapshots (board_id, state, created_at, sealed_with) VALUES ($1, $2, $3, $4)`, [
          boardId,
          snap.data,
          new Date(now),
          snap.sealedWith,
        ]);
      }
      await keepSealedRefs(boardId, sealer);
      return true;
    }),
  );
}

/**
 * Keeps `state` as an automatic snapshot unless the board's newest snapshot (any kind) is younger
 * than `everyMs`. Checked and written under the board's base row lock — the one compaction takes —
 * so instances trying at once (or a compaction) write one snapshot per period, never one each.
 * Returns whether it was taken and when the newest snapshot is from afterwards.
 */
export async function insertSnapshotIfDue(
  boardId: string,
  state: Uint8Array,
  everyMs: number,
  now: number,
): Promise<{ taken: boolean; newestAt: number }> {
  const sealer = await sealerFor(boardId);
  return guard(boardId, () =>
    tx(async (t) => {
      await t.query(`INSERT INTO board_docs (board_id, state, updated_at) VALUES ($1, $2, $3) ON CONFLICT (board_id) DO NOTHING`, [
        boardId,
        EMPTY_UPDATE,
        new Date(now),
      ]);
      await t.query(`SELECT version FROM board_docs WHERE board_id = $1 FOR UPDATE`, [boardId]);
      const last = await t.one<{ at: Date | null }>(`SELECT max(created_at) AS at FROM board_doc_snapshots WHERE board_id = $1`, [boardId]);
      const lastAt = last?.at ? new Date(last.at).getTime() : null;
      if (lastAt !== null && now - lastAt < everyMs) return { taken: false, newestAt: lastAt };
      const snap = sealer.seal('snapshot', state);
      await t.query(`INSERT INTO board_doc_snapshots (board_id, state, created_at, sealed_with) VALUES ($1, $2, $3, $4)`, [boardId, snap.data, new Date(now), snap.sealedWith]);
      await keepSealedRefs(boardId, sealer);
      return { taken: true, newestAt: now };
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Snapshots: version history (KAI-49) and its retention (KAI-72)
// ---------------------------------------------------------------------------------------------

/** 'named' and 'decision' (KAI-161) are never pruned. */
export type SnapshotKind = 'auto' | 'named' | 'before-restore' | 'decision';
/** Kinds retention never removes. */
const KEPT_KINDS = `('named', 'decision')`;

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
  const r = await one<{ state: Uint8Array; sealed_with: string | null }>(`SELECT state, sealed_with FROM board_doc_snapshots WHERE board_id = $1 AND id = $2`, [
    boardId,
    snapshotId,
  ]);
  return r ? openStored(boardId, 'snapshot', r.state, r.sealed_with) : null;
}

// ---- Board layers (layers.ts): one base + log per (board, layer), stored like the board doc ----

export interface StoredLayer extends StoredDoc {
  layer: string;
}

/** Every layer of a board (base + log), in ONE statement for a consistent read. */
export async function loadLayers(boardId: string, onlyLayer?: string): Promise<StoredLayer[]> {
  const rows = await query<{ part: number; layer: string; id: number; data: Uint8Array; sealed_with: string | null }>(
    `SELECT 0 AS part, layer, version AS id, state AS data, sealed_with FROM board_layers WHERE board_id = $1 AND ($2::text IS NULL OR layer = $2)
     UNION ALL
     SELECT 1 AS part, layer, id, data, sealed_with FROM board_layer_updates WHERE board_id = $1 AND ($2::text IS NULL OR layer = $2)
     ORDER BY part, id`,
    [boardId, onlyLayer ?? null],
  );
  const opened = await Promise.all(rows.map((r) => openStored(boardId, r.part === 0 ? 'layer' : 'layer_update', r.data, r.sealed_with, r.layer)));
  const byLayer = new Map<string, StoredLayer>();
  rows.forEach((r, i) => {
    let l = byLayer.get(r.layer);
    if (!l) byLayer.set(r.layer, (l = { layer: r.layer, base: null, version: 0, updates: [] }));
    if (r.part === 0) {
      l.base = opened[i];
      l.version = Number(r.id);
    } else l.updates.push({ id: Number(r.id), data: opened[i] });
  });
  return [...byLayer.values()];
}

export async function appendLayerUpdate(boardId: string, layer: string, update: Uint8Array, now: number): Promise<void> {
  const sealer = await sealerFor(boardId);
  const row = sealer.seal('layer_update', update, layer);
  await guard(boardId, () =>
    tx(async () => {
      await query(`INSERT INTO board_layer_updates (board_id, layer, data, created_at, sealed_with) VALUES ($1, $2, $3, $4, $5)`, [
        boardId,
        layer,
        row.data,
        new Date(now),
        row.sealedWith,
      ]);
      await keepSealedRefs(boardId, sealer);
    }),
  );
}

/** The whole content of a layer of a brand-new (or trashed) board: becomes its base. */
export async function saveInitialLayer(boardId: string, layer: string, state: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    tx(async () => {
      const sealer = await sealerFor(boardId);
      const row = sealer.seal('layer', state, layer);
      await query(
        `INSERT INTO board_layers (board_id, layer, state, updated_at, sealed_with) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (board_id, layer) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at,
           version = board_layers.version + 1, sealed_with = excluded.sealed_with`,
        [boardId, layer, row.data, new Date(now), row.sealedWith],
      );
      await keepSealedRefs(boardId, sealer);
    }),
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
  const sealer = await sealerFor(boardId);
  const base = c.state ? sealer.seal('layer', c.state, layer) : null;
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
      if (base) {
        await t.query(`UPDATE board_layers SET state = $3, version = version + 1, updated_at = $4, sealed_with = $5 WHERE board_id = $1 AND layer = $2`, [
          boardId,
          layer,
          base.data,
          new Date(now),
          base.sealedWith,
        ]);
        await keepSealedRefs(boardId, sealer);
      } else {
        await t.query(`DELETE FROM board_layers WHERE board_id = $1 AND layer = $2`, [boardId, layer]);
      }
      if (c.folded.length)
        await t.query(`DELETE FROM board_layer_updates WHERE board_id = $1 AND id = ANY($2::bigint[])`, [boardId, c.folded]);
      return true;
    }),
  );
}

/** Keeps `state` as a version of the board (named, or the board just before a restore). */
export async function insertSnapshot(
  boardId: string,
  s: { state: Uint8Array; kind: SnapshotKind; name: string | null; createdBy: string | null },
  now: number,
): Promise<SnapshotInfo> {
  const sealer = await sealerFor(boardId);
  const row = sealer.seal('snapshot', s.state);
  const r = await guard(boardId, () =>
    tx(async () => {
      const inserted = await one<SnapshotRow>(
        `INSERT INTO board_doc_snapshots (board_id, state, created_at, kind, name, created_by, sealed_with) VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING ${SNAPSHOT_COLUMNS}`,
        [boardId, row.data, new Date(now), s.kind, s.name, s.createdBy, row.sealedWith],
      );
      await keepSealedRefs(boardId, sealer);
      return inserted;
    }),
  );
  return toInfo(r!);
}

/**
 * Names (or renames) a snapshot, which also exempts it from pruning. A decision's version stays a
 * decision (renaming it in the history renames only the version). Null: not on this board.
 */
export async function nameSnapshot(boardId: string, snapshotId: number, name: string): Promise<SnapshotInfo | null> {
  const r = await one<SnapshotRow>(
    `UPDATE board_doc_snapshots SET kind = CASE WHEN kind = 'decision' THEN kind ELSE 'named' END, name = $3
     WHERE board_id = $1 AND id = $2 RETURNING ${SNAPSHOT_COLUMNS}`,
    [boardId, snapshotId, name],
  );
  return r ? toInfo(r) : null;
}

/** A decision's version once the decision is deleted: an ordinary named version (still never pruned). */
export async function demoteDecisionSnapshot(boardId: string, snapshotId: number): Promise<void> {
  await query(`UPDATE board_doc_snapshots SET kind = 'named' WHERE board_id = $1 AND id = $2 AND kind = 'decision'`, [boardId, snapshotId]);
}

/** One snapshot of the board with its state (null: not on this board). */
export async function snapshotWithState(boardId: string, snapshotId: number): Promise<{ info: SnapshotInfo; state: Uint8Array } | null> {
  const r = await one<SnapshotRow & { state: Uint8Array; sealed_with: string | null }>(
    `SELECT ${SNAPSHOT_COLUMNS}, state, sealed_with FROM board_doc_snapshots WHERE board_id = $1 AND id = $2`,
    [boardId, snapshotId],
  );
  return r ? { info: toInfo(r), state: await openStored(boardId, 'snapshot', r.state, r.sealed_with) } : null;
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

/**
 * Boards (by id, after `afterBoardId`) with snapshots retention could remove: more than one
 * unnamed snapshot, or (with `loneBefore`) an unnamed one older than that.
 */
export async function boardsWithPrunableSnapshots(afterBoardId: string, limit: number, loneBefore: number | null = null): Promise<string[]> {
  const rows = await query<{ board_id: string }>(
    `SELECT board_id FROM board_doc_snapshots WHERE kind NOT IN ${KEPT_KINDS} AND board_id > $1
     GROUP BY board_id HAVING count(*) > 1 OR min(created_at) < $3 ORDER BY board_id LIMIT $2`,
    [afterBoardId, limit, loneBefore === null ? null : new Date(loneBefore)],
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

/** Deletes these snapshots of the board, never a named one or a decision (named meanwhile); returns how many. */
export async function deleteSnapshots(boardId: string, ids: number[]): Promise<number> {
  if (!ids.length) return 0;
  const rows = await query<{ id: number }>(
    `DELETE FROM board_doc_snapshots WHERE board_id = $1 AND id = ANY($2::bigint[]) AND kind NOT IN ${KEPT_KINDS} RETURNING id`,
    [boardId, ids],
  );
  return rows.length;
}

/**
 * What the stored content of these boards takes (documents, update logs, version history,
 * layers), and the upload names it references (matches of `pattern`'s first group).
 */
/** boardId -> bytes of its stored document, history and layers (the admin inventory, #152). */
export async function storedSizesOf(boardIds: string[]): Promise<Map<string, number>> {
  if (!boardIds.length) return new Map();
  const rows = await query<{ board_id: string; n: string | number }>(
    `SELECT board_id, sum(n)::bigint AS n FROM (
       SELECT board_id, octet_length(state) AS n FROM board_docs WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, octet_length(data) FROM board_doc_updates WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, octet_length(state) FROM board_doc_snapshots WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, octet_length(state) FROM board_layers WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, octet_length(data) FROM board_layer_updates WHERE board_id = ANY($1::text[])
     ) s GROUP BY board_id`,
    [boardIds],
  );
  return new Map(rows.map((r) => [r.board_id, Number(r.n)]));
}

export async function storedContentOf(boardIds: string[], pattern: string): Promise<{ bytes: number; names: string[] }> {
  if (!boardIds.length) return { bytes: 0, names: [] };
  const size = await one<{ n: string | number }>(
    `SELECT (
       COALESCE((SELECT sum(octet_length(state)) FROM board_docs WHERE board_id = ANY($1::text[])), 0) +
       COALESCE((SELECT sum(octet_length(data)) FROM board_doc_updates WHERE board_id = ANY($1::text[])), 0) +
       COALESCE((SELECT sum(octet_length(state)) FROM board_doc_snapshots WHERE board_id = ANY($1::text[])), 0) +
       COALESCE((SELECT sum(octet_length(state)) FROM board_layers WHERE board_id = ANY($1::text[])), 0) +
       COALESCE((SELECT sum(octet_length(data)) FROM board_layer_updates WHERE board_id = ANY($1::text[])), 0)
     )::bigint AS n`,
    [boardIds],
  );
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name FROM (
       SELECT regexp_matches(encode(state, 'escape'), $2, 'g') AS m FROM board_docs WHERE board_id = ANY($1::text[])
       UNION ALL SELECT regexp_matches(encode(data, 'escape'), $2, 'g') FROM board_doc_updates WHERE board_id = ANY($1::text[])
       UNION ALL SELECT regexp_matches(encode(state, 'escape'), $2, 'g') FROM board_layers WHERE board_id = ANY($1::text[])
       UNION ALL SELECT regexp_matches(encode(data, 'escape'), $2, 'g') FROM board_layer_updates WHERE board_id = ANY($1::text[])
       UNION ALL SELECT ARRAY[name] FROM board_sealed_refs WHERE board_id = ANY($1::text[])
     ) found`,
    [boardIds, pattern],
  );
  return { bytes: Number(size?.n ?? 0), names: rows.map((r) => r.name) };
}

/**
 * Every match of `pattern`'s first group in any stored document byte: bases, the update log,
 * version-history snapshots and board layers (private drafts, hidden frames), of every board
 * including trashed ones (restricted to `among` when given). Yjs updates store element values as whole UTF-8 strings, and `encode(…, 'escape')`
 * keeps printable ASCII as is, so a URL in a document is found without decoding it in Node.
 */
export async function matchesInStoredDocs(pattern: string, among: readonly string[] | null): Promise<string[]> {
  const rows = await query<{ name: string }>(
    `SELECT DISTINCT m[1] AS name FROM (
       SELECT regexp_matches(encode(state, 'escape'), $1, 'g') AS m FROM board_docs
       UNION ALL SELECT regexp_matches(encode(data, 'escape'), $1, 'g') FROM board_doc_updates
       UNION ALL SELECT regexp_matches(encode(state, 'escape'), $1, 'g') FROM board_doc_snapshots
       UNION ALL SELECT regexp_matches(encode(state, 'escape'), $1, 'g') FROM board_layers
       UNION ALL SELECT regexp_matches(encode(data, 'escape'), $1, 'g') FROM board_layer_updates
       UNION ALL SELECT ARRAY[name] FROM board_sealed_refs
     ) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}

// ---- sealing stored content again (#159: a key turned on, a newer data key, a move) ----

export interface StoredRow {
  table: BlobTable;
  /** The row's id (log and snapshot rows); '' for a base. */
  id: string;
  layer: string;
  data: Uint8Array;
  sealedWith: string | null;
}

/** Every stored blob of the board as stored (sealed or not), with what sealed it. */
export async function storedRowsOf(boardId: string): Promise<StoredRow[]> {
  const rows = await query<{ t: BlobTable; id: string; layer: string; data: Uint8Array; sealed_with: string | null }>(
    `SELECT 'doc' AS t, '' AS id, '' AS layer, state AS data, sealed_with FROM board_docs WHERE board_id = $1
     UNION ALL SELECT 'update', id::text, '', data, sealed_with FROM board_doc_updates WHERE board_id = $1
     UNION ALL SELECT 'snapshot', id::text, '', state, sealed_with FROM board_doc_snapshots WHERE board_id = $1
     UNION ALL SELECT 'layer', '', layer, state, sealed_with FROM board_layers WHERE board_id = $1
     UNION ALL SELECT 'layer_update', id::text, layer, data, sealed_with FROM board_layer_updates WHERE board_id = $1`,
    [boardId],
  );
  return rows.map((r) => ({ table: r.t, id: r.id, layer: r.layer, data: new Uint8Array(r.data), sealedWith: r.sealed_with }));
}

/** The empty placeholder base a compaction locks (never content, so never sealed). */
export const isEmptyPlaceholder = (r: { data: Uint8Array; sealedWith: string | null }) => r.sealedWith === null && Buffer.from(r.data).equals(EMPTY_UPDATE);

/**
 * Replaces each row's blob with `next`, in one transaction, only where the row still holds exactly
 * what was read (a compaction or a save that replaced it meanwhile wrote it under the current key
 * already). Returns how many rows were replaced.
 */
export async function replaceStoredRows(boardId: string, rows: Array<StoredRow & { next: { data: Buffer; sealedWith: string | null } }>, sealer: BoardSealer): Promise<number> {
  return tx(async () => {
    let n = 0;
    for (const r of rows) {
      const old = Buffer.from(r.data);
      const args = [boardId, r.table === 'doc' || r.table === 'layer' ? r.layer : r.id, old, r.next.data, r.next.sealedWith];
      const sql = {
        doc: `UPDATE board_docs SET state = $4, sealed_with = $5 WHERE board_id = $1 AND $2 = '' AND state = $3 RETURNING 1`,
        update: `UPDATE board_doc_updates SET data = $4, sealed_with = $5 WHERE board_id = $1 AND id = $2::bigint AND data = $3 RETURNING 1`,
        snapshot: `UPDATE board_doc_snapshots SET state = $4, sealed_with = $5 WHERE board_id = $1 AND id = $2::bigint AND state = $3 RETURNING 1`,
        layer: `UPDATE board_layers SET state = $4, sealed_with = $5 WHERE board_id = $1 AND layer = $2 AND state = $3 RETURNING 1`,
        layer_update: `UPDATE board_layer_updates SET data = $4, sealed_with = $5 WHERE board_id = $1 AND id = $2::bigint AND data = $3 RETURNING 1`,
      }[r.table];
      if ((await query(sql, args)).length) n++;
    }
    await keepSealedRefs(boardId, sealer);
    return n;
  });
}

/** The boards among these with stored content not sealed with `ref` (null: with sealed content). */
export async function boardsNotSealedWith(boardIds: string[], ref: string | null): Promise<string[]> {
  if (!boardIds.length) return [];
  const rows = await query<{ board_id: string }>(
    `SELECT DISTINCT board_id FROM (
       SELECT board_id, sealed_with, state AS d FROM board_docs WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, sealed_with, data FROM board_doc_updates WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, sealed_with, state FROM board_doc_snapshots WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, sealed_with, state FROM board_layers WHERE board_id = ANY($1::text[])
       UNION ALL SELECT board_id, sealed_with, data FROM board_layer_updates WHERE board_id = ANY($1::text[])
     ) s WHERE sealed_with IS DISTINCT FROM $2 AND NOT (sealed_with IS NULL AND d = $3) ORDER BY board_id`,
    [boardIds, ref, EMPTY_UPDATE],
  );
  return rows.map((r) => r.board_id);
}

/** The boards among these with a row sealed under another workspace's key than the one given for them (a save that raced a move). */
export async function boardsSealedOutside(boards: Array<{ id: string; workspaceId: string }>): Promise<string[]> {
  if (!boards.length) return [];
  const ids = boards.map((b) => b.id);
  const rows = await query<{ board_id: string }>(
    `SELECT DISTINCT s.board_id FROM (
       SELECT board_id, sealed_with FROM board_docs WHERE board_id = ANY($1::text[]) AND sealed_with IS NOT NULL
       UNION ALL SELECT board_id, sealed_with FROM board_doc_updates WHERE board_id = ANY($1::text[]) AND sealed_with IS NOT NULL
       UNION ALL SELECT board_id, sealed_with FROM board_doc_snapshots WHERE board_id = ANY($1::text[]) AND sealed_with IS NOT NULL
       UNION ALL SELECT board_id, sealed_with FROM board_layers WHERE board_id = ANY($1::text[]) AND sealed_with IS NOT NULL
       UNION ALL SELECT board_id, sealed_with FROM board_layer_updates WHERE board_id = ANY($1::text[]) AND sealed_with IS NOT NULL
     ) s JOIN unnest($1::text[], $2::text[]) AS b(id, workspace_id) ON b.id = s.board_id
     WHERE regexp_replace(s.sealed_with, ':[0-9]+$', '') <> b.workspace_id ORDER BY s.board_id`,
    [ids, boards.map((b) => b.workspaceId)],
  );
  return rows.map((r) => r.board_id);
}

// ---- who has pending suggestions where (KAI-224; a hint for withdrawing them) ----

/** One app or token acting for one person, as suggestion records name it (`author`). */
export interface SuggestionAuthorKey {
  userId: string;
  credentialId: string;
}

/** Notes that `boardId` holds pending suggestions of `author` (idempotent; a repeat notes it anew). */
export async function noteSuggestionAuthor(boardId: string, author: SuggestionAuthorKey): Promise<void> {
  await query(
    `INSERT INTO board_suggestion_authors (board_id, user_id, credential_id, noted_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (board_id, user_id, credential_id) DO UPDATE SET noted_at = now()`,
    [boardId, author.userId, author.credentialId],
  );
}

/** Boards that may hold pending suggestions of the person (null: anyone's) through the credential (null: any). */
export async function boardsWithSuggestionsOf(who: { userId: string | null; credentialId: string | null }): Promise<string[]> {
  const rows = await query<{ board_id: string }>(
    `SELECT DISTINCT board_id FROM board_suggestion_authors
     WHERE ($1::text IS NULL OR user_id = $1) AND ($2::text IS NULL OR credential_id = $2)
     ORDER BY board_id`,
    [who.userId, who.credentialId],
  );
  return rows.map((r) => r.board_id);
}

/**
 * Forgets every author of `boardId` but those in `pending` (whose suggestions still wait there).
 * `pending` is a view of the board that can predate a proposal noted moments ago (its records not
 * yet written, saved or relayed), so a hint noted within the last hour is always kept.
 */
export async function keepSuggestionAuthors(boardId: string, pending: readonly SuggestionAuthorKey[]): Promise<void> {
  await query(
    `DELETE FROM board_suggestion_authors
     WHERE board_id = $1 AND noted_at < now() - interval '1 hour'
       AND (user_id, credential_id) NOT IN (SELECT u, c FROM unnest($2::text[], $3::text[]) AS p(u, c))`,
    [boardId, pending.map((p) => p.userId), pending.map((p) => p.credentialId)],
  );
}
