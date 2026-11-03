// Planning poker for participants (parity rank 1; features/estimation, @freero/shared participation.ts).
//
// Owners and editors run planning poker and are trusted with the `estimation` collection (as with
// the rest of the doc). A PARTICIPANT — a commenter or guest taking part — may only pick: write its
// OWN estimate for the round's CURRENT item while that item is not revealed, and take it back. In
// the shared doc that is the bare "has picked" marker (the value stays sealed in its private layer
// until the facilitator reveals the item); in its private layer, the pick itself, a value of the
// round's deck. Anything else it changes in the collection — the round, someone else's estimate, an
// item that is revealed or not being estimated — is undone in the transaction that applies it
// (compensation, as for the vote budget: votingRules.ts).
import type * as Y from 'yjs';
import { ESTIMATION_COLLECTION, ESTIMATION_ROUND_KEY, estimateKey } from '@freero/shared';
import { changedKeys } from './facilitation';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

interface OpenItem {
  roundId: string;
  itemId: string;
  deck: string[];
}

/** The item being estimated right now (round running, not revealed), or null. */
export function openItem(shared: Y.Doc): OpenItem | null {
  if (!shared.share.has(ESTIMATION_COLLECTION)) return null;
  const r = shared.getMap<unknown>(ESTIMATION_COLLECTION).get(ESTIMATION_ROUND_KEY);
  if (!isObj(r) || typeof r.id !== 'string' || !Array.isArray(r.itemIds) || typeof r.index !== 'number' || r.revealed === true) return null;
  const itemId = r.itemIds[r.index];
  const deck = isObj(r.deck) && Array.isArray(r.deck.values) ? r.deck.values.filter((v): v is string => typeof v === 'string') : [];
  return typeof itemId === 'string' ? { roundId: r.id, itemId, deck } : null;
}

/** May participant `userId` set estimation key `key` to `after` (undefined: delete) in the shared doc or its private layer? */
export function participantMayEstimate(key: string, after: unknown, userId: string, open: OpenItem | null, inPrivateLayer: boolean): boolean {
  if (!open || key !== estimateKey(open.roundId, open.itemId, userId)) return false;
  if (after === undefined) return true;
  if (!isObj(after) || after.roundId !== open.roundId || after.itemId !== open.itemId || after.userId !== userId) return false;
  if (inPrivateLayer) return typeof after.value === 'string' && open.deck.includes(after.value);
  return after.sealed === true && after.value === undefined;
}

/**
 * Undoes this transaction's changes to `doc`'s estimation collection a participant may not make.
 * `shared`: the board's shared doc (holds the round); for its private layer pass the layer as `doc`.
 * The map must exist before the transaction (changedKeys). True when it undid something.
 */
export function guardParticipantEstimates(tr: Y.Transaction, doc: Y.Doc, shared: Y.Doc, userId: string): boolean {
  if (!doc.share.has(ESTIMATION_COLLECTION)) return false;
  const map = doc.getMap<unknown>(ESTIMATION_COLLECTION);
  const changes = changedKeys(tr, map);
  if (!changes.size) return false;
  const open = openItem(shared);
  let reverted = false;
  for (const [key, { before, after }] of changes) {
    if (same(before, after) || participantMayEstimate(key, after, userId, open, doc !== shared)) continue;
    if (before === undefined) map.delete(key);
    else map.set(key, before);
    reverted = true;
  }
  return reverted;
}
