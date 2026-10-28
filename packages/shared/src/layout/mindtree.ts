// The mind-map tidy tree: the ONE layout both the web's mind-map feature (tidy up, follow after
// edits, drag preview) and layout from structure (server inserts, the app's "Insert from text")
// run, so a map laid out on either side is already tidy on the other.
//
// Every node gets a horizontal "band" as tall as its visible subtree; sibling bands are stacked
// with a gap and centered on their parent, so sibling subtrees can never overlap. The root never
// moves. Sibling order and (for 'both' maps) the side of each first-level branch come from the
// nodes' current positions, so dragging a node above its sibling or across the root is how users
// reorder — and laying out an already laid-out map changes nothing.
//
// Everything here is cycle-safe: a broken or cyclic parent chain makes the affected nodes orphans,
// never an infinite loop.
import type { Point } from '../geometry';

export type MindDirection = 'right' | 'left' | 'both';
export type MindSide = 'right' | 'left';

/** The geometric/structural slice of a mind-map node the layout needs. */
export interface MindNode {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  direction?: MindDirection;
  createdAt: number;
}

export interface MindTreeIndex<N extends MindNode = MindNode> {
  byId: Map<string, N>;
  /** Children by parent id, in sibling order (top to bottom). */
  kids: Map<string, N[]>;
}

/** Gap between the root and its first level, between deeper levels, and between siblings. */
export const MIND_GAPS = { root: 72, level: 48, sibling: 14 } as const;

const cy = (n: MindNode) => n.y + n.h / 2;
export const mindCx = (n: MindNode) => n.x + n.w / 2;

/** Sibling order: top to bottom, ties by creation. Layout preserves it, so it is stable. */
export function compareMindSiblings(a: MindNode, b: MindNode): number {
  return cy(a) - cy(b) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function indexMindNodes<N extends MindNode>(nodes: readonly N[]): MindTreeIndex<N> {
  const byId = new Map<string, N>();
  const kids = new Map<string, N[]>();
  for (const n of nodes) byId.set(n.id, n);
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n);
    else kids.set(n.parentId, [n]);
  }
  for (const list of kids.values()) list.sort(compareMindSiblings);
  return { byId, kids };
}

/** Which side of its parent a node sits on (decided by position, so it survives drags). */
export function mindSideOf(node: MindNode, parent: MindNode): MindSide {
  return mindCx(node) < mindCx(parent) ? 'left' : 'right';
}

export interface MindLayoutOptions {
  /** Re-split a 'both' map's first-level branches evenly (alternating) instead of keeping their sides. */
  rebalance?: boolean;
}

/** Positions of every node of the map rooted at `rootId` (the root itself stays put). */
export function layoutMindTree(index: MindTreeIndex, rootId: string, opts: MindLayoutOptions = {}): Map<string, Point> {
  return layoutFrom(index, rootId, opts);
}

/**
 * Positions of `id`'s descendants relative to where `id` is now (its side inherited from its
 * parent): what a dragged branch looks like while it travels.
 */
export function layoutMindBranch(index: MindTreeIndex, id: string): Map<string, Point> {
  return layoutFrom(index, id, {});
}

function layoutFrom(index: MindTreeIndex, rootId: string, opts: MindLayoutOptions): Map<string, Point> {
  const out = new Map<string, Point>();
  const root = index.byId.get(rootId);
  if (!root) return out;
  const seen = new Set<string>([root.id]);
  const kidsOf = (n: MindNode): MindNode[] => (index.kids.get(n.id) ?? []).filter((k) => !seen.has(k.id));
  const visibleKids = (n: MindNode): MindNode[] => (n.collapsed ? [] : kidsOf(n));

  const extents = new Map<string, number>();
  const ext = (n: MindNode, guard = new Set<string>()): number => {
    const hit = extents.get(n.id);
    if (hit !== undefined) return hit;
    if (guard.has(n.id)) return n.h;
    guard.add(n.id);
    const ks = visibleKids(n);
    const block = ks.reduce((s, k) => s + ext(k, guard), 0) + MIND_GAPS.sibling * Math.max(0, ks.length - 1);
    const e = Math.max(n.h, block);
    extents.set(n.id, e);
    return e;
  };

  const pos = (n: MindNode): Point => out.get(n.id) ?? { x: n.x, y: n.y };

  /** Hidden descendants are parked behind their collapsed ancestor so they add no bounds. */
  const park = (n: MindNode) => {
    const p = pos(n);
    const stack = [...kidsOf(n)];
    while (stack.length) {
      const d = stack.pop()!;
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      out.set(d.id, { x: Math.round(p.x + (n.w - d.w) / 2), y: Math.round(p.y + (n.h - d.h) / 2) });
      stack.push(...(index.kids.get(d.id) ?? []));
    }
  };

  const placeKids = (n: MindNode, ks: MindNode[], side: MindSide, gap: number) => {
    const p = pos(n);
    const block = ks.reduce((s, k) => s + ext(k), 0) + MIND_GAPS.sibling * Math.max(0, ks.length - 1);
    let top = p.y + n.h / 2 - block / 2;
    for (const k of ks) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const e = ext(k);
      const x = side === 'right' ? p.x + n.w + gap : p.x - gap - k.w;
      out.set(k.id, { x: Math.round(x), y: Math.round(top + (e - k.h) / 2) });
      if (k.collapsed) park(k);
      else placeKids(k, visibleKids(k), side, MIND_GAPS.level);
      top += e + MIND_GAPS.sibling;
    }
  };

  out.set(root.id, { x: root.x, y: root.y });
  if (root.collapsed) {
    park(root);
    return out;
  }
  const parent = root.parentId ? index.byId.get(root.parentId) : undefined;
  if (parent) {
    placeKids(root, visibleKids(root), mindSideOf(root, parent), MIND_GAPS.level);
    return out;
  }
  const first = kidsOf(root);
  const dir = root.direction ?? 'right';
  if (dir !== 'both') {
    placeKids(root, first, dir, MIND_GAPS.root);
    return out;
  }
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  if (opts.rebalance) first.forEach((k, i) => (i % 2 === 0 ? right : left).push(k));
  else for (const k of first) (mindCx(k) < mindCx(root) ? left : right).push(k);
  placeKids(root, right.sort(compareMindSiblings), 'right', MIND_GAPS.root);
  placeKids(root, left.sort(compareMindSiblings), 'left', MIND_GAPS.root);
  return out;
}
