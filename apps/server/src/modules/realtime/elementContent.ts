// Element content on the server (KAI-230, KAI-234): entries of the collections in @freero/shared
// ELEMENT_CONTENT_COLLECTIONS (table cells, presenter notes, activity results, comment threads
// pinned to an item) belong to an element and live in the
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
// An element in more than one doc at once (a move in flight between instances) has no single home:
// its entries stay where they are until it has one. Entries whose element is on no doc follow the
// entry their rule names (`follows`: a comment record, its thread record), else stay put; a
// board-level thread (pinned to no item) lives in the shared doc.
import * as Y from 'yjs';
import { ELEMENT_CONTENT_COLLECTIONS, homeLayer, SERVER_WRITTEN_COLLECTIONS, Y_ELEMENTS } from '@freero/shared';
import { changedKeys } from './facilitation';

export interface ContentEntry {
  name: string;
  key: string;
  value: unknown;
}

/** An entry `guardContentPlacement` moved into `doc`, and what `doc` held under its key before. */
export interface MovedEntry extends ContentEntry {
  doc: Y.Doc;
  before: unknown;
}

const isPlain = (v: unknown) => !(v instanceof Y.AbstractType);

/**
 * A board's docs by layer: 'shared' (the shared doc), 'editors', and private layers under their
 * storage names ('u:<id>'), as @freero/shared `homeLayer` reads them.
 */
export type NamedDocs = ReadonlyArray<readonly [string, Y.Doc]>;

/** The shared doc and the layer docs of a room, named. */
export const namedDocs = (main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>): NamedDocs => [['shared', main], ...layers];

const docsOf = (named: NamedDocs) => named.map(([, d]) => d);

/** Reads entry `key` of collection `name` from the first of `docs` that holds it. */
function reader(name: string, docs: readonly Y.Doc[]): (key: string) => unknown {
  return (key) => {
    for (const d of docs) if (d.share.has(name) && d.getMap<unknown>(name).has(key)) return d.getMap<unknown>(name).get(key);
    return undefined;
  };
}

const holds = (doc: Y.Doc, name: string, key: string) => doc.share.has(name) && doc.getMap<unknown>(name).has(key);

/**
 * The element-content entries in `doc` that belong to one of `ids` (`others`: the board's other
 * docs, where a comment record's thread record may be).
 */
export function contentOf(doc: Y.Doc, ids: ReadonlySet<string>, others: readonly Y.Doc[] = []): ContentEntry[] {
  const out: ContentEntry[] = [];
  if (!ids.size) return out;
  for (const [name, rule] of Object.entries(ELEMENT_CONTENT_COLLECTIONS)) {
    if (!doc.share.has(name)) continue;
    const get = reader(name, [doc, ...others]);
    for (const [key, value] of doc.getMap<unknown>(name)) {
      if (isPlain(value) && rule.owners(key, value, get).some((id) => ids.has(id))) out.push({ name, key, value });
    }
  }
  return out;
}

/**
 * The doc entry `key` (value `value`) of `name` belongs in: its elements' (`homeLayer`: the most
 * visible doc where every one of them is visible, else the most restrictive); with none of them on
 * the board, the doc of the entry it follows (a comment record: its thread record's). An element
 * in two docs at once is moving: `inFlight` 'wait' answers null (no single home yet), 'restrictive'
 * counts the layer it is in. Null also when nothing says (a board-level thread).
 */
export function entryHome(name: string, key: string, value: unknown, named: NamedDocs, inFlight: 'wait' | 'restrictive' = 'wait'): Y.Doc | null {
  const rule = ELEMENT_CONTENT_COLLECTIONS[name];
  if (!rule) return null;
  const docs = docsOf(named);
  const layers: string[] = [];
  for (const id of rule.owners(key, value, reader(name, docs))) {
    const at = named.filter(([, d]) => holds(d, Y_ELEMENTS, id));
    if (!at.length) continue;
    if (at.length > 1 && inFlight === 'wait') return null;
    layers.push((at.find(([n]) => n !== 'shared') ?? at[0])[0]);
  }
  const home = homeLayer(layers);
  if (home) return named.find(([n]) => n === home)?.[1] ?? null;
  const follows = rule.follows?.(key);
  if (!follows) return null;
  const at = docs.filter((d) => holds(d, name, follows));
  return at.length === 1 ? at[0] : null;
}

/**
 * Moves every element-content entry that is not in its home doc into it (one transaction per doc,
 * with `origin`). Returns how many moved. Run when a board loads (`only`: just these collections).
 */
export function placeElementContent(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, origin: unknown, only?: readonly string[]): number {
  const named = namedDocs(main, layers);
  const sets = new Map<Y.Doc, ContentEntry[]>();
  const deletes = new Map<Y.Doc, ContentEntry[]>();
  const add = (m: Map<Y.Doc, ContentEntry[]>, doc: Y.Doc, e: ContentEntry) => m.set(doc, [...(m.get(doc) ?? []), e]);
  let moved = 0;
  // Every home is decided before anything moves (a message asks its thread record, which may move too).
  for (const [, from] of named)
    for (const name of Object.keys(ELEMENT_CONTENT_COLLECTIONS)) {
      if (!from.share.has(name) || (only && !only.includes(name))) continue;
      for (const [key, value] of from.getMap<unknown>(name)) {
        if (!isPlain(value)) continue;
        const home = entryHome(name, key, value, named);
        if (!home || home === from) continue;
        add(sets, home, { name, key, value });
        add(deletes, from, { name, key, value });
        moved++;
      }
    }
  // Into the home doc first, then out of the wrong one: never nowhere.
  for (const [doc, entries] of sets) doc.transact(() => entries.forEach((e) => doc.getMap<unknown>(e.name).set(e.key, e.value)), origin);
  for (const [doc, entries] of deletes) doc.transact(() => entries.forEach((e) => doc.getMap<unknown>(e.name).delete(e.key)), origin);
  return moved;
}

/**
 * Inside the transaction `tr` that applies a socket's update to the shared doc `main`: entries it
 * set whose home is the editors layer, or the writer's own private layer (`homes`; pass only the
 * layers the writer may write), are moved there (`origin` for the layer write: relayed to that
 * layer's readers, the writer included, and saved). The caller sends the writer the shared doc's
 * correction. Returns what moved (with the value its home had before). A home in someone else's
 * private layer is left alone: the writer cannot see it, so what they wrote is their own text, not
 * the draft's.
 */
export function guardContentPlacement(
  tr: Y.Transaction,
  main: Y.Doc,
  homes: { editors: Y.Doc | undefined; own: Y.Doc | undefined },
  origin: unknown,
): MovedEntry[] {
  const named: Array<readonly [string, Y.Doc]> = [['shared', main]];
  if (homes.editors) named.push(['editors', homes.editors]);
  if (homes.own) named.push(['own', homes.own]);
  if (named.length === 1) return [];
  const moves = new Map<Y.Doc, ContentEntry[]>();
  for (const name of Object.keys(ELEMENT_CONTENT_COLLECTIONS)) {
    // Sockets may not write those at all (serverCollections.ts undoes it).
    if (!main.share.has(name) || SERVER_WRITTEN_COLLECTIONS.includes(name)) continue;
    const map = main.getMap<unknown>(name);
    for (const [key, { after }] of changedKeys(tr, map)) {
      if (after === undefined || !isPlain(after)) continue;
      const home = entryHome(name, key, after, named);
      if (home && home !== main) moves.set(home, [...(moves.get(home) ?? []), { name, key, value: after }]);
    }
  }
  const moved: MovedEntry[] = [];
  for (const [doc, entries] of moves) {
    for (const e of entries) moved.push({ ...e, doc, before: doc.share.has(e.name) ? doc.getMap<unknown>(e.name).get(e.key) : undefined });
    doc.transact(() => entries.forEach((e) => doc.getMap<unknown>(e.name).set(e.key, e.value)), origin);
    for (const e of entries) main.getMap<unknown>(e.name).delete(e.key);
  }
  return moved;
}

/**
 * Sets (null: deletes) entries of an element-content collection the way the server writes them
 * (`writeServerCollection`): each into its home doc — counting an element moving between docs as
 * in its layer — and out of every other doc. An entry whose elements are on no doc is not written
 * (nobody could see it). One transaction per doc.
 */
export function writeElementContent(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, name: string, entries: Record<string, unknown>, origin: unknown): void {
  const named = namedDocs(main, layers);
  const writes = new Map<Y.Doc, Array<() => void>>();
  const add = (doc: Y.Doc, fn: () => void) => writes.set(doc, [...(writes.get(doc) ?? []), fn]);
  for (const [key, value] of Object.entries(entries)) {
    const home = value === null ? null : entryHome(name, key, value, named, 'restrictive');
    for (const [, doc] of named) {
      if (doc === home) add(doc, () => doc.getMap<unknown>(name).set(key, value));
      else if (holds(doc, name, key)) add(doc, () => doc.getMap<unknown>(name).delete(key));
    }
  }
  // Into the element's doc first, then out of the others (the shared doc last).
  const ordered = [...writes].sort(([a], [b]) => Number(a === main) - Number(b === main));
  for (const [doc, fns] of ordered) doc.transact(() => fns.forEach((f) => f()), origin);
}
