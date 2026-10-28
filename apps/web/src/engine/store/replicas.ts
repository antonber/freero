// Test support: delivers updates between BoardStores the way the sync server does between
// clients of one board (state-vector diff, applied as a remote change). Not used at runtime.
import * as Y from 'yjs';
import type { BoardStore } from './BoardStore';

/** Origin of updates delivered by syncStores (never LOCAL_ORIGIN: not undoable, no followers). */
export const REPLICA_ORIGIN = { source: 'freero-replica' };

/**
 * One network round: every store receives every change another store has and it lacks — the
 * shared doc, and the editors layer between stores that may read it (owners/editors).
 */
export function syncStores(stores: BoardStore[], editors: BoardStore[] = stores): void {
  const pass = (pick: (s: BoardStore) => Y.Doc, among: BoardStore[]) => {
    for (const from of among)
      for (const to of among) if (from !== to) Y.applyUpdate(pick(to), Y.encodeStateAsUpdate(pick(from), Y.encodeStateVector(pick(to))), REPLICA_ORIGIN);
  };
  pass((s) => s.doc, stores);
  pass((s) => s.layers.editors.doc, editors);
}

/** What the server does when something proposes a change (KAI-169): the records land in the editors layer. */
export function serverPropose(stores: BoardStore[], records: ReadonlyArray<{ id: string }>): void {
  for (const s of stores) {
    const map = s.suggestionsMap();
    s.layers.editors.doc.transact(() => {
      for (const r of records) map.set(r.id, structuredClone(r));
    }, REPLICA_ORIGIN);
  }
}
