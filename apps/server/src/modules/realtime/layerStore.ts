// Board layers in the database, at the Yjs level — the same base + append-only log scheme as the
// board doc (docStore.ts): saving appends only the changes this instance made (idempotent, any
// order, several instances at once), loading merges base and log, compaction folds the log.
// Compaction also deletes a layer that holds nothing, or whose owner may no longer read it
// (`keep` false: a private layer of someone removed from the board).
import * as Y from 'yjs';
import * as repo from './repo';

export interface LoadedLayer {
  layer: string;
  state: Uint8Array | null;
  logRows: number;
}

const merged = (l: repo.StoredLayer): Uint8Array | null => {
  const parts = [...(l.base ? [l.base] : []), ...l.updates.map((u) => u.data)];
  return parts.length === 0 ? null : parts.length === 1 ? parts[0] : Y.mergeUpdates(parts);
};

export async function loadLayers(boardId: string): Promise<LoadedLayer[]> {
  return (await repo.loadLayers(boardId)).map((l) => ({ layer: l.layer, state: merged(l), logRows: l.updates.length }));
}

export async function loadLayer(boardId: string, layer: string): Promise<Uint8Array | null> {
  const [l] = await repo.loadLayers(boardId, layer);
  return l ? merged(l) : null;
}

/** Saves `updates` (in the order they happened) as one log row of the layer. */
export async function appendLayerUpdates(boardId: string, layer: string, updates: Uint8Array[], now = Date.now()): Promise<void> {
  await repo.appendLayerUpdate(boardId, layer, updates.length === 1 ? updates[0] : Y.mergeUpdates(updates), now);
}

export function saveInitialLayer(boardId: string, layer: string, state: Uint8Array, now = Date.now()): Promise<void> {
  return repo.saveInitialLayer(boardId, layer, state, now);
}

/** True when no map of the doc has an entry left (everything revealed, discarded or deleted). */
export function isEmptyLayer(doc: Y.Doc): boolean {
  for (const name of [...doc.share.keys()]) if (doc.getMap(name).size > 0) return false;
  return true;
}

/**
 * Folds one layer's log into its base, or deletes the layer when it is empty or `keep` is false.
 * 'skipped': another compaction replaced the base first.
 */
export async function compactLayer(boardId: string, layer: string, keep: boolean, now = Date.now()): Promise<'compacted' | 'deleted' | 'empty' | 'skipped'> {
  const [stored] = await repo.loadLayers(boardId, layer);
  if (!stored) return 'empty';
  const doc = new Y.Doc();
  try {
    if (stored.base) Y.applyUpdate(doc, stored.base);
    for (const u of stored.updates) Y.applyUpdate(doc, u.data);
    const drop = !keep || isEmptyLayer(doc);
    if (!drop && stored.updates.length === 0) return 'empty'; // nothing to fold
    const ok = await repo.compactLayer(
      boardId,
      layer,
      { fromVersion: stored.version, state: drop ? null : Y.encodeStateAsUpdate(doc), folded: stored.updates.map((u) => u.id) },
      now,
    );
    return !ok ? 'skipped' : drop ? 'deleted' : 'compacted';
  } finally {
    doc.destroy();
  }
}

/** What `doc` holds that the stored layer lacks (see docStore.missingFromStore), or null. */
export async function missingLayerFromStore(boardId: string, layer: string, doc: Y.Doc): Promise<Uint8Array | null> {
  const stored = await loadLayer(boardId, layer);
  const saved = new Y.Doc();
  try {
    if (stored) Y.applyUpdate(saved, stored);
    const missing: Uint8Array[] = [];
    saved.on('update', (u: Uint8Array) => missing.push(u));
    Y.applyUpdate(saved, Y.encodeStateAsUpdate(doc));
    return missing.length ? Y.mergeUpdates(missing) : null;
  } finally {
    saved.destroy();
  }
}
