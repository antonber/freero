// Restoring a version: make the live doc's content equal to an older state, as ordinary NEW
// changes on top of the live doc (never by rewinding history), so every replica converges on it
// and the restore is itself just another change.
//
// The board doc is top-level Y.Maps of plain JSON values (@freero/shared ydoc.ts). For every
// top-level map except `keep` (social / session data): keys missing from the version are deleted,
// keys whose value differs are set to the version's value, equal ones are left untouched (so a
// restore to the current state changes nothing).
//
// A doc's document (KAI-162: the XmlFragment DOC_FRAGMENT) is a tree, not a map of values: when it
// differs from the version's, its children are replaced by copies of the version's (one change;
// what the version and the live doc share is still rewritten, which keeps the rule simple and the
// result exact). Comments stay as they are, like on boards (Y_KEPT_ON_RESTORE).
import * as Y from 'yjs';
import { DOC_FRAGMENT } from '@freero/shared';

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((v, i) => same(v, bb[i]));
  }
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** A value stored in a top-level map, as plain data (nested Yjs types are not used, but be safe). */
const plain = (v: unknown) => (v instanceof Y.AbstractType ? v.toJSON() : v);

/**
 * Writes into `doc` (in the caller's transaction, if any) whatever makes its content equal to
 * `version`, except the top-level types named in `keep`. Returns how many keys it changed.
 */
export function restoreInto(doc: Y.Doc, version: Uint8Array, keep: readonly string[]): number {
  const old = new Y.Doc({ gc: false });
  let changed = 0;
  try {
    Y.applyUpdate(old, version);
    const names = new Set([...doc.share.keys(), ...old.share.keys()]);
    for (const k of keep) names.delete(k);
    doc.transact(() => {
      if (names.delete(DOC_FRAGMENT)) changed += restoreFragment(doc.getXmlFragment(DOC_FRAGMENT), old.getXmlFragment(DOC_FRAGMENT));
      for (const name of names) {
        const live = doc.getMap<unknown>(name);
        const then = old.getMap<unknown>(name);
        for (const key of [...live.keys()])
          if (!then.has(key)) {
            live.delete(key);
            changed++;
          }
        for (const [key, value] of then.entries()) {
          const v = plain(value);
          if (live.has(key) && same(plain(live.get(key)), v)) continue;
          live.set(key, v);
          changed++;
        }
      }
    });
  } finally {
    old.destroy();
  }
  return changed;
}

/** Makes `live` equal to `then` (copies of its nodes); 0 when they are already equal. */
function restoreFragment(live: Y.XmlFragment, then: Y.XmlFragment): number {
  if (live.toString() === then.toString() && sameAttributes(live, then)) return 0;
  if (live.length) live.delete(0, live.length);
  const copies = then.toArray().map((n) => n.clone());
  if (copies.length) live.insert(0, copies as Array<Y.XmlElement | Y.XmlText>);
  return Math.max(1, copies.length);
}

/** XmlElement.toString leaves out attribute values that are not strings (a heading's level): compare those too. */
function sameAttributes(a: Y.XmlFragment | Y.XmlElement, b: Y.XmlFragment | Y.XmlElement): boolean {
  const ka = a.toArray();
  const kb = b.toArray();
  if (ka.length !== kb.length) return false;
  return ka.every((x, i) => {
    const y = kb[i];
    if (x instanceof Y.XmlElement && y instanceof Y.XmlElement)
      return JSON.stringify(x.getAttributes()) === JSON.stringify(y.getAttributes()) && sameAttributes(x, y);
    if (x instanceof Y.XmlText && y instanceof Y.XmlText) return JSON.stringify(x.toDelta()) === JSON.stringify(y.toDelta());
    return false;
  });
}
