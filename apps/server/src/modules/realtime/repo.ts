// The only writer of `board_docs`, `board_doc_updates`, `board_doc_snapshots`, `board_layers`,
// `board_layer_updates` and `board_suggestion_authors` [S4].
// A document = its compacted base (board_docs) + the update log written since (board_doc_updates).
// Yjs itself lives in docStore.ts; this file only moves bytes.
import { isForeignKeyViolation, one, query, tx } from '../../platform/db';
import { appendOutbox } from '../../platform/outbox';

/**
 * Outbox topic of a board's shared content changing (key `board:<id>`), appended in the same
 * transaction as the saved change: derived indexes (references) recompute from the stored doc.
 * Private and editors layers never raise it — what they hold is not every reader's content.
 */
export const BOARD_CONTENT_TOPIC = 'board.content';
const contentChanged = (boardId: string) => appendOutbox(BOARD_CONTENT_TOPIC, `board:${boardId}`);

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
    tx(async () => {
      await query(`INSERT INTO board_doc_updates (board_id, data, created_at) VALUES ($1, $2, $3)`, [boardId, toBuffer(update), new Date(now)]);
      await contentChanged(boardId);
    }),
  );
}

/** The whole content of a brand-new board (a duplicate): becomes its base. */
export async function saveInitialState(boardId: string, state: Uint8Array, now: number): Promise<void> {
  await guard(boardId, () =>
    tx(async () => {
      await query(
        `INSERT INTO board_docs (board_id, state, updated_at) VALUES ($1, $2, $3)
         ON CONFLICT (board_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at,
           version = board_docs.version + 1`,
        [boardId, toBuffer(state), new Date(now)],
      );
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
      await t.query(`INSERT INTO board_doc_snapshots (board_id, state, created_at) VALUES ($1, $2, $3)`, [boardId, toBuffer(state), new Date(now)]);
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
  const r = await one<SnapshotRow & { state: Uint8Array }>(
    `SELECT ${SNAPSHOT_COLUMNS}, state FROM board_doc_snapshots WHERE board_id = $1 AND id = $2`,
    [boardId, snapshotId],
  );
  return r ? { info: toInfo(r), state: toBytes(r.state) } : null;
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
     ) found
     WHERE $2::text[] IS NULL OR m[1] = ANY($2::text[])`,
    [pattern, among],
  );
  return rows.map((r) => r.name);
}

// ---- who has pending suggestions where (KAI-224; a hint for withdrawing them) ----

/** One app or token acting for one person, as suggestion records name it (`author`). */
export interface SuggestionAuthorKey {
  userId: string;
  credentialId: string;
}

/** Notes that `boardId` holds pending suggestions of `author` (idempotent). */
export async function noteSuggestionAuthor(boardId: string, author: SuggestionAuthorKey): Promise<void> {
  await query(`INSERT INTO board_suggestion_authors (board_id, user_id, credential_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [
    boardId,
    author.userId,
    author.credentialId,
  ]);
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

/** Forgets every author of `boardId` but those in `pending` (whose suggestions still wait there). */
export async function keepSuggestionAuthors(boardId: string, pending: readonly SuggestionAuthorKey[]): Promise<void> {
  await query(
    `DELETE FROM board_suggestion_authors
     WHERE board_id = $1 AND (user_id, credential_id) NOT IN (SELECT u, c FROM unnest($2::text[], $3::text[]) AS p(u, c))`,
    [boardId, pending.map((p) => p.userId), pending.map((p) => p.credentialId)],
  );
}
