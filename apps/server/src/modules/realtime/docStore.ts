// Board documents in the database, at the Yjs level: a compacted base plus an append-only log.
//
// - Saving appends only what changed since the last save (cost independent of board size).
// - Loading applies the base and every log row; Yjs updates are idempotent and commute, so
//   duplicate rows (several instances saving the same change) and any row order are harmless.
// - Compaction folds the log into a new base, off the save path: it reads base + rows, merges them
//   without holding a lock, then swaps the base and deletes exactly the rows it read, provided no
//   other compaction replaced the base meanwhile. Rows written during a compaction stay in the log.
// - A snapshot (full state) is kept at most every `snapshotEveryMs` (config): version history. Taken
//   by compaction, and by a loaded room on a timer while the board keeps changing (snapshotIfDue).
import * as Y from 'yjs';
import { getConfig } from '../../platform/config';
import * as repo from './repo';

export { BoardGoneError } from './repo';
export type { SnapshotInfo } from './repo';

/** Compact once a loaded board's log holds this many rows or bytes. */
export const COMPACT_AFTER_ROWS = 200;
export const COMPACT_AFTER_BYTES = 2 * 1024 * 1024;
/** Minimum time between two automatic snapshots of one board (FREERO_SNAPSHOT_EVERY_MS). */
export const snapshotEveryMs = (): number => getConfig().snapshotEveryMs;

export interface LoadedDoc {
  /** Everything stored, as one update (null: nothing stored yet). */
  state: Uint8Array | null;
  /** Log rows not yet compacted, and their size. */
  logRows: number;
  logBytes: number;
}

export async function loadDoc(boardId: string): Promise<LoadedDoc> {
  const stored = await repo.loadDoc(boardId);
  if (!stored) return { state: null, logRows: 0, logBytes: 0 };
  const parts = [...(stored.base ? [stored.base] : []), ...stored.updates.map((u) => u.data)];
  return {
    state: parts.length === 0 ? null : parts.length === 1 ? parts[0] : Y.mergeUpdates(parts),
    logRows: stored.updates.length,
    logBytes: stored.updates.reduce((n, u) => n + u.data.byteLength, 0),
  };
}

/** Saves `updates` (in the order they happened) as one log row. */
export async function appendUpdates(boardId: string, updates: Uint8Array[], now = Date.now()): Promise<number> {
  const update = updates.length === 1 ? updates[0] : Y.mergeUpdates(updates);
  await repo.appendUpdate(boardId, update, now);
  return update.byteLength;
}

/** The content of a brand-new board (a duplicate). */
export function saveInitialState(boardId: string, state: Uint8Array, now = Date.now()): Promise<void> {
  return repo.saveInitialState(boardId, state, now);
}

/**
 * Folds the board's log into its base (and maybe takes a snapshot). 'skipped': another compaction
 * replaced the base first (its result already covers what we read); try again later if needed.
 */
export async function compactDoc(boardId: string, now = Date.now()): Promise<'compacted' | 'empty' | 'skipped'> {
  const stored = await repo.loadDoc(boardId);
  if (!stored || stored.updates.length === 0) return 'empty';
  // Applying into a doc (rather than Y.mergeUpdates) garbage-collects deleted content.
  const doc = new Y.Doc();
  try {
    if (stored.base) Y.applyUpdate(doc, stored.base);
    for (const u of stored.updates) Y.applyUpdate(doc, u.data);
    const state = Y.encodeStateAsUpdate(doc);
    const ok = await repo.compact(
      boardId,
      { fromVersion: stored.version, state, folded: stored.updates.map((u) => u.id), snapshotEveryMs: snapshotEveryMs() },
      now,
    );
    return ok ? 'compacted' : 'skipped';
  } finally {
    doc.destroy();
  }
}

/**
 * Keeps `state` (the live board) as an automatic snapshot if the newest snapshot is at least
 * `snapshotEveryMs` old; across instances only one of several trying at once takes it.
 */
export function snapshotIfDue(boardId: string, state: Uint8Array, now = Date.now()): Promise<{ taken: boolean; newestAt: number }> {
  return repo.insertSnapshotIfDue(boardId, state, snapshotEveryMs(), now);
}

/**
 * What `doc` holds that the database does not (as one update), or null when the database already
 * has everything. Used by an instance about to drop a doc that also received other instances'
 * changes, in case the instance that made them died before saving.
 */
export async function missingFromStore(boardId: string, doc: Y.Doc): Promise<Uint8Array | null> {
  const stored = await loadDoc(boardId);
  const saved = new Y.Doc();
  try {
    if (stored.state) Y.applyUpdate(saved, stored.state);
    const missing: Uint8Array[] = [];
    saved.on('update', (u: Uint8Array) => missing.push(u));
    Y.applyUpdate(saved, Y.encodeStateAsUpdate(doc));
    return missing.length ? Y.mergeUpdates(missing) : null;
  } finally {
    saved.destroy();
  }
}

/** Version history: the board's snapshots, newest first. */
export function listSnapshots(boardId: string): Promise<repo.SnapshotInfo[]> {
  return repo.listSnapshots(boardId);
}

/** Version history: the full document state at a snapshot (null: no such snapshot on this board). */
export function loadSnapshot(boardId: string, snapshotId: number): Promise<Uint8Array | null> {
  return repo.loadSnapshot(boardId, snapshotId);
}
