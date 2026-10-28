// A board as ONE reader sees it (the semantic outline, layout placement), and the one way the
// server changes board content on a request (insert structure). Pure over Y.Docs; rooms.ts runs
// both against the live room.
//
// Reading applies the same rules as a socket: the shared doc, plus the 'editors' layer for owners
// and editors (hidden frames' contents), plus the reader's OWN private layer (their drafts,
// marked as private). Never another user's private layer. Viewers and commenters also never see
// shared-doc elements under a hidden frame (in flight to the editors layer), like the web client
// (`isOffBoard`).
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { Y_ELEMENTS, type BoardElement, type ElementDraft, type ElementType, type Role } from '@freero/shared';
import { EDITORS_LAYER, privateLayerOf } from './layers';

export type ViewLayer = 'shared' | 'editors' | 'private';

export interface BoardReader {
  userId: string;
  role: Role;
}

export interface BoardView {
  /** Every element the reader can see, with the doc it lives in. */
  elements: Array<{ el: BoardElement; layer: ViewLayer }>;
  /** A collection of the shared doc (empty when absent). */
  collection(name: string): ReadonlyMap<string, unknown>;
  /** The reader may see hidden frames' contents. */
  seesHidden: boolean;
  /** Changes whenever what the reader can see changes. Base64url, 22 chars. */
  version: string;
}

const canEdit = (role: Role) => role === 'owner' || role === 'editor';

const isElement = (v: unknown): v is BoardElement => {
  const e = v as Partial<BoardElement> | null;
  return !!e && typeof e === 'object' && typeof e.id === 'string' && typeof e.type === 'string';
};
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Board content is untrusted: a value without usable geometry still reads, at (0, 0). */
function elementsOf(doc: Y.Doc | undefined): BoardElement[] {
  if (!doc || !doc.share.has(Y_ELEMENTS)) return [];
  const out: BoardElement[] = [];
  for (const [key, v] of doc.getMap<unknown>(Y_ELEMENTS).entries()) {
    if (!isElement(v) || v.id !== key) continue;
    const ok = [v.x, v.y, v.w, v.h].every((n) => typeof n === 'number' && Number.isFinite(n));
    out.push(ok ? v : ({ ...v, x: num(v.x), y: num(v.y), w: num(v.w), h: num(v.h) } as BoardElement));
  }
  return out;
}

/** The docs `reader` may read, by view layer. */
function readable(layers: ReadonlyMap<string, Y.Doc>, reader: BoardReader): Array<[ViewLayer, Y.Doc | undefined]> {
  return [
    ['editors', canEdit(reader.role) ? layers.get(EDITORS_LAYER) : undefined],
    ['private', layers.get(privateLayerOf(reader.userId))],
  ];
}

export function viewOf(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, reader: BoardReader): BoardView {
  const seesHidden = canEdit(reader.role);
  const byId = new Map<string, { el: BoardElement; layer: ViewLayer }>();
  for (const el of elementsOf(main)) byId.set(el.id, { el, layer: 'shared' });
  // A layer's copy wins: it is where the element is moving to (hidden frame, a draft being revealed).
  for (const [layer, doc] of readable(layers, reader)) for (const el of elementsOf(doc)) byId.set(el.id, { el, layer });

  if (!seesHidden) {
    // Inside a hidden frame (at any depth): withheld from viewers and commenters.
    const offBoard = (el: BoardElement, depth = 0): boolean => {
      if (!el.frameId || depth > 32) return false;
      const parent = byId.get(el.frameId)?.el;
      if (!parent) return false;
      if (parent.type === 'frame' && parent.hidden) return true;
      return offBoard(parent, depth + 1);
    };
    for (const [id, { el }] of [...byId]) if (offBoard(el)) byId.delete(id);
  }

  const cache = new Map<string, ReadonlyMap<string, unknown>>();
  const collection = (name: string): ReadonlyMap<string, unknown> => {
    let hit = cache.get(name);
    if (!hit) {
      hit = name !== Y_ELEMENTS && main.share.has(name) ? new Map(main.getMap<unknown>(name).entries()) : new Map();
      cache.set(name, hit);
    }
    return hit;
  };

  const hash = createHash('sha256');
  hash.update(`${seesHidden ? 'e' : 'v'}:${reader.userId}\n`);
  hash.update(Y.encodeStateAsUpdate(main));
  for (const [layer, doc] of readable(layers, reader)) {
    hash.update(`\n${layer}\n`);
    if (doc) hash.update(Y.encodeStateAsUpdate(doc));
  }
  return { elements: [...byId.values()], collection, seesHidden, version: hash.digest('base64url').slice(0, 22) };
}

/** One change to a board's content, applied as ONE transaction per doc it touches. */
export interface BoardChange {
  /** New elements (fresh ids), stacked above everything in the given order. */
  create?: ElementDraft[];
  /** Field patches of elements the actor can see (shallow merge; `id` and `type` never change). */
  update?: Array<{ id: string; patch: Record<string, unknown> }>;
  /** Entries to set in feature collections of the shared doc (content kept outside elements). */
  collections?: Record<string, Record<string, unknown>>;
}

export interface AppliedChange {
  created: string[];
  updated: string[];
}

export class BoardChangeError extends Error {}

const KNOWN_TYPES = new Set<ElementType>([
  'sticky', 'shape', 'text', 'connector', 'pen', 'frame', 'image', 'card', 'emoji', 'mindmap', 'table', 'embed', 'icon', 'kanban', 'pdf',
]);

/**
 * Applies `change` for `actor` (an owner or editor: the caller checked). New elements and
 * collection entries go to the shared doc; an update goes to the doc the element lives in (one the
 * actor may write). Every doc is written in one transaction with `origin`.
 */
export function applyChange(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, change: BoardChange, actor: BoardReader, origin: unknown, now = Date.now()): AppliedChange {
  if (!canEdit(actor.role)) throw new BoardChangeError('Only owners and editors change board content');
  const view = viewOf(main, layers, actor);
  const where = new Map(view.elements.map((e) => [e.el.id, e]));
  const docOf: Record<ViewLayer, Y.Doc | undefined> = {
    shared: main,
    editors: layers.get(EDITORS_LAYER),
    private: layers.get(privateLayerOf(actor.userId)),
  };
  for (const name of Object.keys(change.collections ?? {}))
    if (name === Y_ELEMENTS || name === 'settings') throw new BoardChangeError(`'${name}' is not a collection`);
  const ids = new Set<string>();
  for (const d of change.create ?? []) {
    if (!KNOWN_TYPES.has(d.type) || typeof d.id !== 'string' || !d.id) throw new BoardChangeError('Malformed element');
    if (where.has(d.id) || ids.has(d.id) || main.getMap(Y_ELEMENTS).has(d.id)) throw new BoardChangeError(`Element ${d.id} already exists`);
    ids.add(d.id);
  }
  const updates = (change.update ?? []).map((u) => {
    const at = where.get(u.id);
    if (!at) throw new BoardChangeError(`No element ${u.id} on this board`);
    return { ...u, at };
  });

  let z = view.elements.reduce((m, e) => Math.max(m, typeof e.el.z === 'number' ? e.el.z : 0), 0);
  const byDoc = new Map<Y.Doc, Array<() => void>>();
  const queue = (doc: Y.Doc, fn: () => void) => byDoc.set(doc, [...(byDoc.get(doc) ?? []), fn]);
  const elementsMap = main.getMap<unknown>(Y_ELEMENTS);
  for (const d of change.create ?? []) {
    const el = { ...d, z: ++z, createdBy: actor.userId, createdAt: now, updatedAt: now } as BoardElement;
    queue(main, () => elementsMap.set(el.id, el));
  }
  for (const u of updates) {
    const doc = docOf[u.at.layer]!;
    const { id: _id, type: _type, ...patch } = u.patch as Record<string, unknown>;
    queue(doc, () => doc.getMap<unknown>(Y_ELEMENTS).set(u.id, { ...u.at.el, ...patch, updatedAt: now }));
  }
  for (const [name, entries] of Object.entries(change.collections ?? {})) {
    const map = main.getMap<unknown>(name);
    queue(main, () => {
      for (const [k, v] of Object.entries(entries)) map.set(k, v);
    });
  }
  for (const [doc, writes] of byDoc) doc.transact(() => writes.forEach((w) => w()), origin);
  return { created: (change.create ?? []).map((d) => d.id), updated: updates.map((u) => u.id) };
}
