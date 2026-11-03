// Pure tree helpers over mind-map nodes (unit-tested). A node's tree is defined by `parentId`
// links; `rootId` is a denormalized hint only. Everything here is cycle-safe: a broken or
// cyclic chain makes the affected nodes orphans (hidden), never an infinite loop.

import { compareMindSiblings, indexMindNodes, mindCx, mindGrowsDown, mindSideIn, type MindDirection, type MindNode, type MindSide, type MindTreeIndex } from '@freero/shared';

// The tree model and its ordering rules live in @freero/shared (layout/mindtree.ts), next to the
// tidy-tree layout that layout from structure runs too: one definition for web and server.
export type Direction = MindDirection;
export type Side = MindSide;
export type { MindNode };
export type TreeIndex<N extends MindNode = MindNode> = MindTreeIndex<N>;

export const cx = mindCx;
/** Sibling order: top to bottom, ties by creation. Layout preserves it, so it is stable. */
export const compareSiblings = compareMindSiblings;
export const indexNodes = indexMindNodes;
/**
 * Where a node sits from its parent: below it in a top-down map (#134), otherwise the side its
 * position says (so it survives drags).
 */
export const sideOf = mindSideIn;
/** The map `id` is in grows downwards. */
export const growsDown = mindGrowsDown;

/** `id` followed by all its descendants (depth-first). */
export function subtreeIds(index: TreeIndex, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    out.push(cur);
    const ks = index.kids.get(cur);
    if (ks) for (let i = ks.length - 1; i >= 0; i--) stack.push(ks[i].id);
  }
  return out;
}

/** The root reached by following parent links, or null for orphans / cycles. */
export function rootOf<N extends MindNode>(index: TreeIndex<N>, id: string): N | null {
  const seen = new Set<string>();
  let cur = index.byId.get(id);
  while (cur) {
    if (seen.has(cur.id)) return null;
    seen.add(cur.id);
    if (!cur.parentId) return cur;
    cur = index.byId.get(cur.parentId);
  }
  return null;
}


export interface NodeInfo {
  /** Not rendered and not hit-testable: under a collapsed ancestor, or its parent is gone. */
  hidden: boolean;
  /** Id of the root this node hangs from (null for orphans). */
  root: string | null;
  depth: number;
  childCount: number;
  descendantCount: number;
  /** Sides on which this node has children (for collapse hubs and edge anchors). */
  kidsRight: boolean;
  kidsLeft: boolean;
  /** [#134] Its children are below it (a top-down map). */
  kidsDown: boolean;
  /** Where it sits from its parent (null: a root or an orphan). */
  side: Side | null;
}

export function computeInfo(index: TreeIndex): Map<string, NodeInfo> {
  const out = new Map<string, NodeInfo>();
  const visit = (n: MindNode, root: string, depth: number, hidden: boolean): number => {
    if (out.has(n.id)) return 0; // cycle guard
    const parent = n.parentId ? index.byId.get(n.parentId) : undefined;
    const info: NodeInfo = { hidden, root, depth, childCount: 0, descendantCount: 0, kidsRight: false, kidsLeft: false, kidsDown: false, side: parent ? sideOf(index, n, parent) : null };
    out.set(n.id, info);
    const ks = index.kids.get(n.id) ?? [];
    info.childCount = ks.length;
    let count = 0;
    for (const k of ks) {
      const s = sideOf(index, k, n);
      if (s === 'left') info.kidsLeft = true;
      else if (s === 'down') info.kidsDown = true;
      else info.kidsRight = true;
      count += 1 + visit(k, root, depth + 1, hidden || !!n.collapsed);
    }
    info.descendantCount = count;
    return count;
  };
  for (const n of index.byId.values()) if (!n.parentId) visit(n, n.id, 0, false);
  // Whatever wasn't reached from a root is an orphan (its parent was deleted elsewhere).
  for (const n of index.byId.values())
    if (!out.has(n.id))
      out.set(n.id, { hidden: true, root: null, depth: 0, childCount: 0, descendantCount: 0, kidsRight: false, kidsLeft: false, kidsDown: false, side: null });
  return out;
}

/** Ids of nodes whose ancestor chain no longer reaches a root (left behind by a plain delete). */
export function orphanIds(index: TreeIndex): string[] {
  const out: string[] = [];
  for (const n of index.byId.values()) if (n.parentId && !rootOf(index, n.id)) out.push(n.id);
  return out;
}
