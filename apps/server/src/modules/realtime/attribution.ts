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
// A NEW draft in someone's private layer while private mode is anonymous (#44, `draftsAreAnonymous`)
// is by ANONYMOUS_AUTHOR instead of the socket's user: only its author ever reads that layer, and
// the draft carries no name into the reveal, whatever the session says by then. Nobody else can
// write the marker: a socket's own claim of it is rewritten like any other claim.
//
// `createdVia` is only ever set by the server: accepting an app's suggestion in the app makes the
// acceptor the creator and the proposer `suggestedBy`, as the client already writes it.
import * as Y from 'yjs';
import { ANONYMOUS_AUTHOR, type PrivateModeSession } from '@freero/shared';
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
 * Do new private drafts go unnamed (see the header)? While the board's private mode is anonymous —
 * and after an anonymous session ended (kept with `active: false`), for drafts that were on their
 * way at the reveal. The shared doc's `privateMode` session, as features/private-mode writes it.
 */
export function draftsAreAnonymous(main: Y.Doc): boolean {
  const s = main.getMap<unknown>('privateMode').get('session') as Partial<PrivateModeSession> | undefined;
  return isObj(s) && s.anonymous === true;
}

/** Who a socket's new element is by: its user, or nobody for a draft in its private layer while drafts are anonymous. */
export const creatorOf = (userId: string, privateLayer: boolean, main: Y.Doc): string =>
  privateLayer && draftsAreAnonymous(main) ? ANONYMOUS_AUTHOR : userId;

/**
 * Rewrites the attribution of elements this transaction added or changed (see the header).
 * `creator`: whom a new element is by (the socket's user, or `creatorOf`). `known(id)`: the
 * attribution the room already holds for an element that is in another of its docs or was removed
 * lately (a move or an undo), else undefined. Returns how many it rewrote.
 */
export function guardAttribution(tr: Y.Transaction, elements: Y.Map<unknown>, creator: string, known: (id: string) => Attribution | undefined): number {
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
    const want: Attribution = prior ?? { createdBy: creator, createdVia: undefined };
    if (same(after.createdBy, want.createdBy) && same(after.createdVia, want.createdVia)) continue;
    elements.set(key, withAttribution(after, want, ['createdBy', 'createdVia']));
    n++;
  }
  return n;
}
