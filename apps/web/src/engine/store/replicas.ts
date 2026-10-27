// Test support: delivers updates between BoardStores the way the sync server does between
// clients of one board (state-vector diff, applied as a remote change). Not used at runtime.
import * as Y from 'yjs';
import type { BoardStore } from './BoardStore';

/** Origin of updates delivered by syncStores (never LOCAL_ORIGIN: not undoable, no followers). */
export const REPLICA_ORIGIN = { source: 'freero-replica' };

/** One network round: every store receives every change another store has and it lacks. */
export function syncStores(stores: BoardStore[]): void {
  for (const from of stores)
    for (const to of stores)
      if (from !== to) Y.applyUpdate(to.doc, Y.encodeStateAsUpdate(from.doc, Y.encodeStateVector(to.doc)), REPLICA_ORIGIN);
}
