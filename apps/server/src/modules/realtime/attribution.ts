// Who made an element, as the server knows it (KAI-222). Elements written on a request
// (`changeBoard`: the public API, MCP, insert structure) are stamped by the server: `createdBy` =
// the person, `createdVia` = the app or token acting for them. Elements written over a board SOCKET
// would otherwise carry whatever the client put in them, so a modified client could create a sticky
// "by" someone else, or "Claude for <someone>". This guard runs inside the transaction that applies
// a socket's update (the shared doc and the layers), like the facilitation guards: what it rewrites
// reaches nobody else, and the sender is sent the correction, so its doc converges.
//
//   an element ADDED by the socket   createdBy = the socket's user, no createdVia — unless it is an
//                                    element the room already knows (moved between docs: a hidden
//                                    frame, private mode; or re-added by undo after a deletion),
//                                    which keeps the attribution it had there
//   an element CHANGED by the socket createdBy / createdVia / createdAt stay what they were
//
// `createdVia` is only ever set by the server: accepting an app's suggestion in the app makes the
// acceptor the creator and the proposer `suggestedBy`, as the client already writes it.
import * as Y from 'yjs';
import { changedKeys } from './facilitation';

/** The fields only the server decides. */
export interface Attribution {
  createdBy: unknown;
  createdVia: unknown;
  createdAt?: unknown;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const attributionOf = (v: unknown): Attribution | undefined =>
  isObj(v) ? { createdBy: v.createdBy, createdVia: v.createdVia, createdAt: v.createdAt } : undefined;

/** `el` with `want`'s attribution fields (absent ones removed). */
function withAttribution(el: Record<string, unknown>, want: Attribution, fields: Array<keyof Attribution>): Record<string, unknown> {
  const out = { ...el };
  for (const f of fields) {
    if (want[f] === undefined || want[f] === null) delete out[f];
    else out[f] = want[f];
  }
  return out;
}

/**
 * Rewrites the attribution of elements this transaction added or changed (see the header).
 * `known(id)`: the attribution the room already holds for an element that is in another of its docs
 * or was removed lately (a move or an undo), else undefined. Returns how many it rewrote.
 */
export function guardAttribution(tr: Y.Transaction, elements: Y.Map<unknown>, userId: string, known: (id: string) => Attribution | undefined): number {
  let n = 0;
  for (const [key, { before, after }] of changedKeys(tr, elements)) {
    if (!isObj(after)) continue; // removed (or not an element at all: nothing to attribute)
    if (isObj(before)) {
      const was = attributionOf(before)!;
      if (same(after.createdBy, was.createdBy) && same(after.createdVia, was.createdVia) && same(after.createdAt, was.createdAt)) continue;
      elements.set(key, withAttribution(after, was, ['createdBy', 'createdVia', 'createdAt']));
      n++;
      continue;
    }
    const prior = known(key);
    const want: Attribution = prior ?? { createdBy: userId, createdVia: undefined };
    if (same(after.createdBy, want.createdBy) && same(after.createdVia, want.createdVia)) continue;
    elements.set(key, withAttribution(after, want, ['createdBy', 'createdVia']));
    n++;
  }
  return n;
}
