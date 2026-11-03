// Protected locks (BaseElement.lockProtected), enforced here next to the facilitation guards. An
// ordinary lock is a courtesy every editor can lift; a protected one only the board owner and the
// person running the facilitation session may (`mayOverrideProtection`). Anyone else's socket
// change is undone in the same transaction that applies it — compensation, not dropping, as in
// facilitation.ts: nobody else ever receives it, the sender is sent the correction and converges.
//
//   the element before          what the socket may do to it
//   protected                   nothing: a change or a deletion is put back — unless the deletion
//                               moves it to another doc of the room (a frame hidden or shown,
//                               `existsElsewhere`), which carries the protection along
//   not protected / new         anything but protect it: a `lockProtected` it adds is taken off
//                               (the item keeps its ordinary lock) — unless it arrives from
//                               another doc of the room, protected there already
//
// Requests (API, MCP: realtime/view.ts applyChange) refuse the same changes with an error.
import * as Y from 'yjs';
import { isProtectedLock } from '@freero/shared';
import { changedKeys } from './facilitation';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Undoes what a socket that may not override protection did to protected items. Returns how many it fixed. */
export function guardProtectedLocks(tr: Y.Transaction, elements: Y.Map<unknown>, existsElsewhere: (id: string) => boolean): number {
  let n = 0;
  for (const [key, { before, after }] of changedKeys(tr, elements)) {
    const was = isObj(before) && isProtectedLock(before);
    if (was) {
      if (after === undefined ? existsElsewhere(key) : same(before, after)) continue;
      elements.set(key, before);
      n++;
      continue;
    }
    if (!isObj(after) || !after.lockProtected) continue;
    if (before === undefined && existsElsewhere(key)) continue;
    const { lockProtected: _dropped, ...rest } = after;
    elements.set(key, rest);
    n++;
  }
  return n;
}
