// Collections of the board doc that only the SERVER writes (KAI-132): results it computes from
// what it keeps elsewhere — the live activities' results (ENGAGE_RESULTS_COLLECTION), which
// modules/engage derives from answers that never enter the board, and the tracker issue badges
// (TRACKER_COLLECTION), which modules/trackers keeps in step with its links (KAI-153). Owners and
// editors are trusted with the rest of the doc, but results they could rewrite would be results nobody can trust, so
// a socket's change to such a collection — in the shared doc or in a layer doc (whence a reveal
// could carry it into the shared doc) — is undone in the same transaction, like the vote budget
// (votingRules.ts): the sender is sent the correction and converges.
import type * as Y from 'yjs';
import { ENGAGE_RESULTS_COLLECTION, TRACKER_COLLECTION } from '@freero/shared';
import { changedKeys } from './facilitation';

export const SERVER_COLLECTIONS: readonly string[] = [ENGAGE_RESULTS_COLLECTION, TRACKER_COLLECTION];

/** Creates the guarded maps up front: changedKeys sees only maps that existed before a transaction. */
export function prepareServerCollections(doc: Y.Doc): void {
  for (const name of SERVER_COLLECTIONS) doc.getMap<unknown>(name);
}

/** Undoes this transaction's changes to server-written collections of `doc`. True when it undid something. */
export function guardServerCollections(tr: Y.Transaction, doc: Y.Doc): boolean {
  let reverted = false;
  for (const name of SERVER_COLLECTIONS) {
    if (!doc.share.has(name)) continue;
    const map = doc.getMap<unknown>(name);
    for (const [key, { before }] of changedKeys(tr, map)) {
      if (before === undefined) map.delete(key);
      else map.set(key, before);
      reverted = true;
    }
  }
  return reverted;
}
