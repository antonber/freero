// Diagrams as code: re-laying edited source onto a diagram already on the board (pure,
// unit-tested). The new layout is matched to the elements the last layout made by source key
// (`LaidOut.keys`: a node's id, an edge's ends, a group …), and each kept element is merged three
// ways — what the last layout wrote, what is on the board now, what the new layout wants:
//   - a field nobody changed on the board takes the new layout's value;
//   - a field someone changed on the board (text, colour, size, a moved box) keeps their change;
//   - lines always take the new geometry (they follow their boxes anyway).
// Items whose source is gone are removed; new source items are created. Locked items are left
// alone. Mind-map topics always take the new order; the mind map's own tidy layout places them.
import { translateDraft, type BoardElement, type ElementDraft, type LaidOut } from '@freero/shared';
import type { TextKind } from './parse';

/** What a diagram inserted from text remembers (the `diagramSources` collection, by diagram id). */
export interface DiagramRecord {
  v: 1;
  kind: TextKind;
  source: string;
  /** Source key → element id on the board. */
  ids: Record<string, string>;
  /** Element id → the element as the last layout wrote it (absolute coordinates). */
  laid: Record<string, ElementDraft>;
}

export interface UpdatePlan {
  create: ElementDraft[];
  update: Array<{ id: string; patch: Record<string, unknown> }>;
  remove: string[];
  record: DiagramRecord;
  /** Mind-map roots to tidy after the change (their topics' order changed). */
  mindRoots: string[];
}

/** Fields that are bookkeeping, never merged. */
const SKIP = new Set(['id', 'type', 'z', 'createdBy', 'createdAt', 'updatedAt', 'frameId', 'locked', 'groupId', 'attachedTo', 'link']);
/** Line geometry: always the new layout's (endpoints follow their boxes anyway). */
const LINE_GEOMETRY = new Set(['x', 'y', 'w', 'h', 'start', 'end', 'waypoints', 'rotation']);
/** Tree structure of mind-map topics: always the new layout's (positions only encode order). */
const MIND_STRUCTURE = new Set(['x', 'y', 'parentId', 'rootId']);

const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
};

function bounds(drafts: ElementDraft[]): { x: number; y: number } | null {
  const boxes = drafts.filter((d) => d.type !== 'connector');
  if (!boxes.length) return null;
  return { x: Math.min(...boxes.map((d) => d.x)), y: Math.min(...boxes.map((d) => d.y)) };
}

/** How far the whole diagram was moved since it was laid out: the offset most of its boxes share. */
function commonOffset(record: DiagramRecord, current: (id: string) => BoardElement | undefined): { dx: number; dy: number } {
  const votes = new Map<string, { dx: number; dy: number; n: number }>();
  for (const [id, was] of Object.entries(record.laid)) {
    if (was.type === 'connector') continue;
    const now = current(id);
    if (!now) continue;
    const k = `${now.x - was.x},${now.y - was.y}`;
    const v = votes.get(k) ?? { dx: now.x - was.x, dy: now.y - was.y, n: 0 };
    v.n++;
    votes.set(k, v);
  }
  let best = { dx: 0, dy: 0, n: 0 };
  for (const v of votes.values()) if (v.n > best.n) best = v;
  return best;
}

/** Element ids a draft points at (line ends, its frame, its mind-map parent / root), remapped. */
function remap(d: ElementDraft, map: (id: string) => string): ElementDraft {
  const out = { ...d } as ElementDraft & Record<string, unknown>;
  if (out.frameId) out.frameId = map(out.frameId);
  if (out.type === 'connector') {
    if (out.start.elementId) out.start = { ...out.start, elementId: map(out.start.elementId) };
    if (out.end.elementId) out.end = { ...out.end, elementId: map(out.end.elementId) };
  }
  if (out.type === 'mindmap') {
    if (out.parentId) out.parentId = map(out.parentId);
    out.rootId = map(out.rootId);
  }
  return out;
}

export function planUpdate(opts: {
  record: DiagramRecord;
  source: string;
  /** The new layout from (0, 0), with keys. */
  laid: LaidOut;
  current: (id: string) => BoardElement | undefined;
  /** Keep items people moved by hand where they put them (default true). */
  keepMoved?: boolean;
}): UpdatePlan {
  const { record, laid, current } = opts;
  const keepMoved = opts.keepMoved ?? true;
  const keys = laid.keys ?? {};
  const shift = commonOffset(record, current);

  // Where the new drawing goes: a mind map keeps its root where it is; anything else keeps its
  // top-left where the old drawing's is now.
  const rootDraft = laid.elements.find((d) => d.type === 'mindmap' && !d.parentId);
  const oldRootId = rootDraft ? record.ids[keys[rootDraft.id]] : undefined;
  const oldRoot = oldRootId ? current(oldRootId) : undefined;
  let at: { x: number; y: number };
  if (rootDraft && oldRoot) at = { x: oldRoot.x - rootDraft.x, y: oldRoot.y - rootDraft.y };
  else {
    const was = bounds(Object.values(record.laid)) ?? { x: 0, y: 0 };
    at = { x: was.x + shift.dx, y: was.y + shift.dy };
  }

  // Match new elements to the board's by key (same type, still there).
  const idOf = new Map<string, string>();
  for (const d of laid.elements) {
    const key = keys[d.id];
    const old = key ? record.ids[key] : undefined;
    const el = old ? current(old) : undefined;
    idOf.set(d.id, el && el.type === d.type ? el.id : d.id);
  }
  const reused = new Set([...idOf.values()].filter((id) => current(id)));
  const placed = laid.elements.map((d) => remap({ ...translateDraft(d, at.x, at.y), id: idOf.get(d.id)! } as ElementDraft, (id) => idOf.get(id) ?? id));

  const create: ElementDraft[] = [];
  const update: UpdatePlan['update'] = [];
  const mindRoots = new Set<string>();
  for (const next of placed) {
    const el = current(next.id);
    if (next.type === 'mindmap') mindRoots.add((next as { rootId: string }).rootId);
    if (!el) {
      create.push(next);
      continue;
    }
    if (el.locked) continue;
    const was = record.laid[el.id] as (ElementDraft & Record<string, unknown>) | undefined;
    const now = el as unknown as Record<string, unknown>;
    const want = next as unknown as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const movedByHand = !!was && (now.x !== (was.x as number) + shift.dx || now.y !== (was.y as number) + shift.dy);
    for (const f of Object.keys(want)) {
      if (SKIP.has(f)) continue;
      let take: boolean;
      if (el.type === 'connector' && LINE_GEOMETRY.has(f)) take = true;
      else if (el.type === 'mindmap' && MIND_STRUCTURE.has(f)) take = true;
      else if (f === 'x' || f === 'y') take = !(keepMoved && movedByHand);
      // Unchanged on the board since the last layout (or never laid out by it): the new value.
      else take = !was || !(f in was) || same(now[f], was[f]);
      if (take && !same(now[f], want[f])) patch[f] = want[f];
    }
    if ((next.frameId ?? null) !== (el.frameId ?? null)) patch.frameId = next.frameId ?? null;
    if (Object.keys(patch).length) update.push({ id: el.id, patch });
  }

  const remove = Object.values(record.ids).filter((id) => {
    const el = current(id);
    return !!el && !reused.has(id) && !el.locked;
  });

  const ids: Record<string, string> = {};
  for (const d of laid.elements) if (keys[d.id]) ids[keys[d.id]] = idOf.get(d.id)!;
  return {
    create,
    update,
    remove,
    record: { v: 1, kind: record.kind, source: opts.source, ids, laid: Object.fromEntries(placed.map((d) => [d.id, d])) },
    mindRoots: [...mindRoots],
  };
}

/** The record for a diagram just inserted from `laid` (already placed). */
export function newRecord(kind: TextKind, source: string, laid: LaidOut): DiagramRecord {
  const ids: Record<string, string> = {};
  for (const [id, key] of Object.entries(laid.keys ?? {})) ids[key] = id;
  return { v: 1, kind, source, ids, laid: Object.fromEntries(laid.elements.map((d) => [d.id, d])) };
}
