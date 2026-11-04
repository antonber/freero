// Links between boards and docs pointed at their copies (#161: a blueprint used makes copies of
// several boards and docs; links among them must lead to the copies, not back to the originals).
// Walks a stored document state — every collection's values (items, their text, comments…) and
// a doc's rich-text fragment (attributes, link marks, text) — and rewrites every board / doc
// address (`/board/<id>`, `/doc/<id>`, `freero://board/<id>`, `freero://doc/<id>`, absolute URLs
// included) whose id is in `ids`. Anything else is left exactly as it was.
import * as Y from 'yjs';
import { DOC_FRAGMENT, Y_LEFT_OUT_OF_BACKUPS } from '@freero/shared';

const LINK = /(\/(?:board|doc)\/|freero:\/\/(?:board|doc)\/)([A-Za-z0-9_-]{1,64})/g;

function rewriteString(s: string, ids: ReadonlyMap<string, string>): string {
  if (!s.includes('/board/') && !s.includes('/doc/')) return s;
  return s.replace(LINK, (whole, prefix: string, id: string) => (ids.has(id) ? prefix + ids.get(id) : whole));
}

/** A plain JSON value with links rewritten (the same object when nothing changed). */
function rewriteJson(v: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (typeof v === 'string') return rewriteString(v, ids);
  if (Array.isArray(v)) {
    let changed = false;
    const out = v.map((x) => {
      const y = rewriteJson(x, ids);
      if (y !== x) changed = true;
      return y;
    });
    return changed ? out : v;
  }
  if (v && typeof v === 'object' && !(v instanceof Uint8Array)) {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const y = rewriteJson(x, ids);
      if (y !== x) changed = true;
      out[k] = y;
    }
    return changed ? out : v;
  }
  return v;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(t: Y.AbstractType<any>, ids: ReadonlyMap<string, string>): void {
  if (t instanceof Y.Map) {
    for (const [k, v] of [...t.entries()]) {
      if (v instanceof Y.AbstractType) walk(v, ids);
      else {
        const next = rewriteJson(v, ids);
        if (next !== v) t.set(k, next);
      }
    }
  } else if (t instanceof Y.Array) {
    const items = t.toArray();
    for (let i = items.length - 1; i >= 0; i--) {
      const v = items[i];
      if (v instanceof Y.AbstractType) walk(v, ids);
      else {
        const next = rewriteJson(v, ids);
        if (next !== v) {
          t.delete(i, 1);
          t.insert(i, [next]);
        }
      }
    }
  } else if (t instanceof Y.XmlElement || t instanceof Y.XmlFragment) {
    if (t instanceof Y.XmlElement)
      for (const [k, v] of Object.entries(t.getAttributes())) {
        const next = rewriteJson(v, ids);
        if (next !== v) t.setAttribute(k, next as string);
      }
    for (const child of t.toArray()) walk(child as Y.AbstractType<any>, ids);
  } else if (t instanceof Y.Text) {
    // Back to front, so the offsets of what is still to do stay right.
    const ops = t.toDelta() as Array<{ insert: unknown; attributes?: Record<string, unknown> }>;
    const at: number[] = [];
    let pos = 0;
    for (const op of ops) {
      at.push(pos);
      pos += typeof op.insert === 'string' ? op.insert.length : 1;
    }
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i];
      const attrs = op.attributes ? (rewriteJson(op.attributes, ids) as Record<string, unknown>) : undefined;
      if (typeof op.insert === 'string') {
        const text = rewriteString(op.insert, ids);
        if (text !== op.insert) {
          t.delete(at[i], op.insert.length);
          t.insert(at[i], text, attrs ?? {});
        } else if (attrs !== op.attributes) t.format(at[i], op.insert.length, attrs ?? {});
      } else if (op.insert instanceof Y.AbstractType) walk(op.insert, ids);
    }
  }
}

/**
 * A board's content as a blueprint keeps it (#161): the work without the conversation and the
 * sessions around it — comments, and what a backup leaves out too (votes, timers, calls, tracker
 * badges…), are emptied, so a new programme starts clean. (Yjs collects what is deleted, so the
 * removed entries' content doesn't travel in the state.)
 */
export function blueprintState(state: Uint8Array): Uint8Array {
  const drop = new Set<string>(['comments', ...Y_LEFT_OUT_OF_BACKUPS]);
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const names = [...doc.share.keys()].filter((n) => drop.has(n));
    doc.transact(() => {
      for (const name of names) {
        const map = doc.getMap(name);
        for (const k of [...map.keys()]) map.delete(k);
      }
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}

/** `state` with every link to a board or doc in `ids` (old id → new id) pointing at the new one. */
export function rewriteObjectLinks(state: Uint8Array, ids: ReadonlyMap<string, string>): Uint8Array {
  if (ids.size === 0) return state;
  const doc = new Y.Doc();
  try {
    Y.applyUpdate(doc, state);
    const names = [...doc.share.keys()];
    doc.transact(() => {
      for (const name of names) walk(name === DOC_FRAGMENT ? doc.getXmlFragment(name) : doc.getMap(name), ids);
    });
    return Y.encodeStateAsUpdate(doc);
  } finally {
    doc.destroy();
  }
}
