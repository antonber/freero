// Tidy-tree layout for one mind map (pure, unit-tested).
//
// Every node gets a horizontal "band" as tall as its visible subtree; sibling bands are stacked
// with a gap and centered on their parent, so sibling subtrees can never overlap. The root never
// moves. Sibling order and (for 'both' maps) the side of each first-level branch come from the
// nodes' current positions, so dragging a node above its sibling or across the root is how users
// reorder — and laying out an already laid-out map changes nothing.
import type { Point } from '@engine';
import { compareSiblings, cx, sideOf, type MindNode, type Side, type TreeIndex } from './tree';

export const ROOT_GAP = 72;
export const LEVEL_GAP = 48;
export const SIBLING_GAP = 14;

export interface LayoutOptions {
  /** Re-split a 'both' map's first-level branches evenly instead of keeping their sides. */
  rebalance?: boolean;
}

/** Positions of every node of the map rooted at `rootId` (the root itself stays put). */
export function layoutTree(index: TreeIndex, rootId: string, opts: LayoutOptions = {}): Map<string, Point> {
  return layoutFrom(index, rootId, opts);
}

/**
 * Positions of `id`'s descendants relative to where `id` is now (its side inherited from its
 * parent): what a dragged branch looks like while it travels.
 */
export function layoutBranch(index: TreeIndex, id: string): Map<string, Point> {
  return layoutFrom(index, id, {});
}

function layoutFrom(index: TreeIndex, rootId: string, opts: LayoutOptions): Map<string, Point> {
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
    const block = ks.reduce((s, k) => s + ext(k, guard), 0) + SIBLING_GAP * Math.max(0, ks.length - 1);
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

  const placeKids = (n: MindNode, ks: MindNode[], side: Side, gap: number) => {
    const p = pos(n);
    const block = ks.reduce((s, k) => s + ext(k), 0) + SIBLING_GAP * Math.max(0, ks.length - 1);
    let top = p.y + n.h / 2 - block / 2;
    for (const k of ks) {
      if (seen.has(k.id)) continue;
      seen.add(k.id);
      const e = ext(k);
      const x = side === 'right' ? p.x + n.w + gap : p.x - gap - k.w;
      out.set(k.id, { x: Math.round(x), y: Math.round(top + (e - k.h) / 2) });
      if (k.collapsed) park(k);
      else placeKids(k, visibleKids(k), side, LEVEL_GAP);
      top += e + SIBLING_GAP;
    }
  };

  out.set(root.id, { x: root.x, y: root.y });
  if (root.collapsed) {
    park(root);
    return out;
  }
  const parent = root.parentId ? index.byId.get(root.parentId) : undefined;
  if (parent) {
    placeKids(root, visibleKids(root), sideOf(root, parent), LEVEL_GAP);
    return out;
  }
  const first = kidsOf(root);
  const dir = root.direction ?? 'right';
  if (dir !== 'both') {
    placeKids(root, first, dir, ROOT_GAP);
    return out;
  }
  const right: MindNode[] = [];
  const left: MindNode[] = [];
  if (opts.rebalance) first.forEach((k, i) => (i % 2 === 0 ? right : left).push(k));
  else for (const k of first) (cx(k) < cx(root) ? left : right).push(k);
  placeKids(root, right.sort(compareSiblings), 'right', ROOT_GAP);
  placeKids(root, left.sort(compareSiblings), 'left', ROOT_GAP);
  return out;
}
