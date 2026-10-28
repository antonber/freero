// Element content on the server (KAI-230): entries of the collections in @freero/shared
// ELEMENT_CONTENT_COLLECTIONS (table cells, presenter notes) belong to an element and live in the
// SAME doc as it — the shared doc, the `editors` layer (inside a hidden frame) or the author's
// private layer — so a table in a hidden frame or a private draft never sends its text to sockets
// that may not read the table. The web client keeps the rule on every write and move
// (engine/store, editor/layers.ts); the server keeps it where it writes or receives content itself:
//
//   - requests (view.ts applyChange): new entries go to their element's doc; an element a request
//     moves between docs takes its entries along, in the same step;
//   - reveal / discard of private drafts (layers.ts applyLayerOp): their entries go with them;
//   - a socket's write (rooms.ts onUpdate, `guardContentPlacement`): an entry written into the shared
//     doc for an element that lives only in the editors layer, or only in the writer's own private
//     layer (their other tab had not seen the move yet, or an older client), is moved there INSIDE
//     the transaction that applies the update, so no other socket ever receives it;
//   - loading a board (rooms.ts load, `placeElementContent`): every entry not in its element's doc
//     moves there. Idempotent; this is also how boards from before the rule are migrated;
//   - collections only the server writes (SERVER_WRITTEN_COLLECTIONS: live activities' results):
//     clients never move them (a socket's write to them is undone), so the room places them after
//     every change of where elements live, and `writeServerCollection` writes each entry into its
//     element's doc in the first place.
//
// An element in more than one doc at once (a move in flight between instances) or in none (deleted)
// has no single home: its entries stay where they are until it has one.
import * as Y from 'yjs';
import { ELEMENT_CONTENT_COLLECTIONS, SERVER_WRITTEN_COLLECTIONS, Y_ELEMENTS } from '@freero/shared';
import { changedKeys } from './facilitation';

export interface ContentEntry {
  name: string;
  key: string;
  value: unknown;
}

const isPlain = (v: unknown) => !(v instanceof Y.AbstractType);

/** The element-content entries in `doc` that belong to one of `ids`. */
export function contentOf(doc: Y.Doc, ids: ReadonlySet<string>): ContentEntry[] {
  const out: ContentEntry[] = [];
  if (!ids.size) return out;
  for (const [name, ownerOf] of Object.entries(ELEMENT_CONTENT_COLLECTIONS)) {
    if (!doc.share.has(name)) continue;
    for (const [key, value] of doc.getMap<unknown>(name)) {
      const owner = ownerOf(key);
      if (owner && ids.has(owner) && isPlain(value)) out.push({ name, key, value });
    }
  }
  return out;
}

/** The one doc holding element `id` (null: none, or more than one while a move is in flight). */
export function homeOf(id: string, docs: readonly Y.Doc[]): Y.Doc | null {
  let home: Y.Doc | null = null;
  for (const doc of docs) {
    if (!doc.share.has(Y_ELEMENTS) || !doc.getMap<unknown>(Y_ELEMENTS).has(id)) continue;
    if (home) return null;
    home = doc;
  }
  return home;
}

/**
 * Moves every element-content entry that is not in its element's doc into that doc (one
 * transaction per doc, with `origin`). Returns how many moved. Run when a board loads.
 */
export function placeElementContent(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, origin: unknown, only?: readonly string[]): number {
  const docs = [main, ...layers.values()];
  const sets = new Map<Y.Doc, ContentEntry[]>();
  const deletes = new Map<Y.Doc, ContentEntry[]>();
  const add = (m: Map<Y.Doc, ContentEntry[]>, doc: Y.Doc, e: ContentEntry) => m.set(doc, [...(m.get(doc) ?? []), e]);
  let moved = 0;
  for (const from of docs)
    for (const [name, ownerOf] of Object.entries(ELEMENT_CONTENT_COLLECTIONS)) {
      if (!from.share.has(name) || (only && !only.includes(name))) continue;
      for (const [key, value] of from.getMap<unknown>(name)) {
        const owner = ownerOf(key);
        const home = owner ? homeOf(owner, docs) : null;
        if (!home || home === from || !isPlain(value)) continue;
        add(sets, home, { name, key, value });
        add(deletes, from, { name, key, value });
        moved++;
      }
    }
  // Into the element's doc first, then out of the wrong one: never nowhere.
  for (const [doc, entries] of sets) doc.transact(() => entries.forEach((e) => doc.getMap<unknown>(e.name).set(e.key, e.value)), origin);
  for (const [doc, entries] of deletes) doc.transact(() => entries.forEach((e) => doc.getMap<unknown>(e.name).delete(e.key)), origin);
  return moved;
}

/**
 * Inside the transaction `tr` that applies a socket's update to the shared doc `main`: entries it
 * set for an element that lives only in the editors layer, or only in the writer's own private
 * layer, are moved there (`origin` for the layer write: relayed to that layer's readers, the writer
 * included, and saved). The writer is sent the shared doc's correction by the caller. Returns how
 * many moved. An element in someone else's private layer is left alone: the writer cannot see it,
 * so what they wrote is their own text, not the draft's.
 */
export function guardContentPlacement(
  tr: Y.Transaction,
  main: Y.Doc,
  homes: { editors: Y.Doc | undefined; own: Y.Doc | undefined },
  origin: unknown,
): number {
  const candidates = [homes.editors, homes.own].filter((d): d is Y.Doc => !!d);
  if (!candidates.length) return 0;
  const sharedElements = main.getMap<unknown>(Y_ELEMENTS);
  const moves = new Map<Y.Doc, ContentEntry[]>();
  for (const [name, ownerOf] of Object.entries(ELEMENT_CONTENT_COLLECTIONS)) {
    // Sockets may not write those at all (serverCollections.ts undoes it).
    if (!main.share.has(name) || SERVER_WRITTEN_COLLECTIONS.includes(name)) continue;
    const map = main.getMap<unknown>(name);
    for (const [key, { after }] of changedKeys(tr, map)) {
      if (after === undefined || !isPlain(after)) continue;
      const owner = ownerOf(key);
      if (!owner || sharedElements.has(owner)) continue;
      const home = candidates.find((d) => d.share.has(Y_ELEMENTS) && d.getMap<unknown>(Y_ELEMENTS).has(owner));
      if (home) moves.set(home, [...(moves.get(home) ?? []), { name, key, value: after }]);
    }
  }
  let moved = 0;
  for (const [doc, entries] of moves) {
    doc.transact(() => entries.forEach((e) => doc.getMap<unknown>(e.name).set(e.key, e.value)), origin);
    for (const e of entries) main.getMap<unknown>(e.name).delete(e.key);
    moved += entries.length;
  }
  return moved;
}

/**
 * Sets (null: deletes) entries of an element-content collection the way the server writes them
 * (`writeServerCollection`): each into its element's doc — the layer when the element is in one,
 * even while it is also still in the shared doc (a move in flight) — and out of every other doc.
 * An entry whose element is on no doc is not written (nobody could see it). One transaction per doc.
 */
export function writeElementContent(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, name: string, entries: Record<string, unknown>, origin: unknown): void {
  const ownerOf = ELEMENT_CONTENT_COLLECTIONS[name];
  const docs = [main, ...layers.values()];
  const writes = new Map<Y.Doc, Array<() => void>>();
  const add = (doc: Y.Doc, fn: () => void) => writes.set(doc, [...(writes.get(doc) ?? []), fn]);
  for (const [key, value] of Object.entries(entries)) {
    const owner = ownerOf?.(key);
    const holding = owner ? docs.filter((d) => d.share.has(Y_ELEMENTS) && d.getMap<unknown>(Y_ELEMENTS).has(owner)) : [];
    const home = value === null ? null : (holding.find((d) => d !== main) ?? holding[0] ?? null);
    for (const doc of docs) {
      if (doc === home) add(doc, () => doc.getMap<unknown>(name).set(key, value));
      else if (doc.share.has(name) && doc.getMap<unknown>(name).has(key)) add(doc, () => doc.getMap<unknown>(name).delete(key));
    }
  }
  // Into the element's doc first, then out of the others (the shared doc last).
  const ordered = [...writes].sort(([a], [b]) => Number(a === main) - Number(b === main));
  for (const [doc, fns] of ordered) doc.transact(() => fns.forEach((f) => f()), origin);
}
