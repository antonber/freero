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
import { FACILITATION_COLLECTION } from '@freero/shared';
import { commenterMayChangeComments } from './commentRules';
import { effectiveAccess, readFacilitation } from './facilitation';
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
  /**
   * Elements the actor can see to delete — with what goes with them, as in the app: a frame's
   * contents, the riders of an item (reaction stamps), a mind-map node's branch.
   */
  remove?: string[];
  /**
   * Entries to set in feature collections of the shared doc (content kept outside elements).
   * Commenters may only write `comments`, and there only records they own (commentRules.ts).
   */
  collections?: Record<string, Record<string, unknown>>;
}

export interface AppliedChange {
  created: string[];
  updated: string[];
  /** Everything deleted: the ids asked for and what went with them. */
  removed: string[];
}

export class BoardChangeError extends Error {}

const KNOWN_TYPES = new Set<ElementType>([
  'sticky', 'shape', 'text', 'connector', 'pen', 'frame', 'image', 'card', 'emoji', 'mindmap', 'table', 'embed', 'icon', 'kanban', 'pdf', 'swimlane',
]);
const COMMENTS = 'comments';

/** Every id `ids` takes along when deleted: contents of frames (any depth), riders, mind-map branches. */
function withDependents(ids: Iterable<string>, all: readonly BoardElement[]): Set<string> {
  const out = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const el of all) {
      if (out.has(el.id)) continue;
      const parentId = el.type === 'mindmap' ? (el as { parentId?: string | null }).parentId : null;
      if ((el.frameId && out.has(el.frameId)) || (el.attachedTo && out.has(el.attachedTo)) || (parentId && out.has(parentId))) {
        out.add(el.id);
        grew = true;
      }
    }
  }
  return out;
}

/** Whether a hidden frame encloses `el` (at any depth), on the board as `byId` holds it. */
function underHiddenFrame(el: BoardElement, byId: ReadonlyMap<string, BoardElement>): boolean {
  let at = el;
  for (let depth = 0; at.frameId && depth <= 32; depth++) {
    const parent = byId.get(at.frameId);
    if (!parent) return false;
    if (parent.type === 'frame' && parent.hidden) return true;
    at = parent;
  }
  return false;
}

/**
 * Applies `change` for `actor`. Owners and editors may change anything they can see; commenters
 * only their own comment records. New elements and collection entries go to the shared doc,
 * updates to the doc the element lives in — except that the hidden-frame rule is kept here, as
 * every owner/editor client keeps it: whatever ends up inside a hidden frame lives in the
 * `editors` layer (never in the shared doc, which every viewer's socket receives), and whatever
 * no longer is moves back. Every doc is written in one transaction with `origin`.
 */
export function applyChange(main: Y.Doc, layers: ReadonlyMap<string, Y.Doc>, change: BoardChange, actor: BoardReader, origin: unknown, now = Date.now()): AppliedChange {
  for (const name of Object.keys(change.collections ?? {}))
    if (name === Y_ELEMENTS || name === 'settings' || name === FACILITATION_COLLECTION) throw new BoardChangeError(`'${name}' is not a collection`);
  // A facilitator's limits hold for requests too (facilitation.ts), not only for sockets: a locked
  // board makes its editors commenters for now.
  const limited = effectiveAccess(actor.role, actor.userId, readFacilitation(main));
  const editor = canEdit(limited.role);
  if (!editor) {
    const onlyComments =
      !change.create?.length && !change.update?.length && !change.remove?.length && Object.keys(change.collections ?? {}).every((n) => n === COMMENTS);
    if (limited.role !== 'commenter' || !onlyComments)
      throw new BoardChangeError(limited.limits ? `${limited.limits.byName ?? 'The facilitator'} has locked the board for now` : 'Only owners and editors change board content');
    const comments = main.getMap<unknown>(COMMENTS);
    const changes = Object.entries(change.collections?.[COMMENTS] ?? {}).map(([key, after]) => ({ key, before: comments.get(key), after }));
    if (!commenterMayChangeComments(changes, actor.userId, (k) => comments.get(k), () => comments.keys()))
      throw new BoardChangeError('Commenters may only write their own comments');
  }
  const addTypes = limited.limits?.addTypes;
  if (addTypes && (change.create ?? []).some((d) => !addTypes.includes(d.type)))
    throw new BoardChangeError(`${limited.limits?.byName ?? 'The facilitator'} limited what can be added right now`);
  const view = viewOf(main, layers, actor);
  const where = new Map(view.elements.map((e) => [e.el.id, e]));
  const docOf = (layer: ViewLayer): Y.Doc | undefined =>
    layer === 'shared' ? main : layer === 'editors' ? layers.get(EDITORS_LAYER) : layers.get(privateLayerOf(actor.userId));

  const ids = new Set<string>();
  for (const d of change.create ?? []) {
    if (!KNOWN_TYPES.has(d.type) || typeof d.id !== 'string' || !d.id) throw new BoardChangeError('Malformed element');
    if (where.has(d.id) || ids.has(d.id) || main.getMap(Y_ELEMENTS).has(d.id)) throw new BoardChangeError(`Element ${d.id} already exists`);
    ids.add(d.id);
  }
  for (const id of change.remove ?? []) if (!where.has(id)) throw new BoardChangeError(`No element ${id} on this board`);
  const removed = withDependents(change.remove ?? [], view.elements.map((e) => e.el));

  // The board as it will be: each element's new value and the layer it lives in now (null: new).
  const next = new Map<string, { el: BoardElement; from: ViewLayer | null; changed: boolean }>();
  for (const { el, layer } of view.elements) if (!removed.has(el.id)) next.set(el.id, { el, from: layer, changed: false });
  const updated: string[] = [];
  for (const u of change.update ?? []) {
    const at = next.get(u.id);
    if (!at) throw new BoardChangeError(where.has(u.id) ? `Element ${u.id} is being deleted` : `No element ${u.id} on this board`);
    const { id: _id, type: _type, ...patch } = u.patch;
    next.set(u.id, { el: { ...at.el, ...patch, updatedAt: now } as BoardElement, from: at.from, changed: true });
    updated.push(u.id);
  }
  let z = view.elements.reduce((m, e) => Math.max(m, typeof e.el.z === 'number' ? e.el.z : 0), 0);
  for (const d of change.create ?? [])
    next.set(d.id, { el: { ...d, z: ++z, createdBy: actor.userId, createdAt: now, updatedAt: now } as BoardElement, from: null, changed: true });

  const byDoc = new Map<Y.Doc, Array<() => void>>();
  const queue = (doc: Y.Doc | undefined, fn: () => void) => {
    if (!doc) throw new BoardChangeError('That part of the board is not available right now');
    byDoc.set(doc, [...(byDoc.get(doc) ?? []), fn]);
  };
  const elementsOfDoc = (doc: Y.Doc | undefined) => doc?.getMap<unknown>(Y_ELEMENTS);
  for (const id of removed) {
    const doc = docOf(where.get(id)!.layer);
    queue(doc, () => elementsOfDoc(doc)!.delete(id));
  }
  if (editor) {
    const byId = new Map([...next].map(([id, n]) => [id, n.el]));
    // Only what this change touches is re-placed: its own elements and everything inside a frame it
    // changed (hidden / shown / moved). Anything else stays where the clients keep it.
    const touched = withDependents([...next].filter(([, n]) => n.changed).map(([id]) => id), [...byId.values()]);
    for (const [id, n] of next) {
      if (!touched.has(id)) continue;
      // Private drafts stay private; everything else goes where the hidden-frame rule puts it.
      const to: ViewLayer = n.from === 'private' ? 'private' : underHiddenFrame(n.el, byId) ? 'editors' : 'shared';
      if (!n.changed && n.from === to) continue;
      if (n.from && n.from !== to) {
        const old = docOf(n.from);
        queue(old, () => elementsOfDoc(old)!.delete(id));
      }
      const doc = docOf(to);
      queue(doc, () => elementsOfDoc(doc)!.set(id, n.el));
    }
  }
  for (const [name, entries] of Object.entries(change.collections ?? {})) {
    const map = main.getMap<unknown>(name);
    queue(main, () => {
      for (const [k, v] of Object.entries(entries)) map.set(k, v);
    });
  }
  for (const [doc, writes] of byDoc) doc.transact(() => writes.forEach((w) => w()), origin);
  return { created: (change.create ?? []).map((d) => d.id), updated, removed: [...removed] };
}
