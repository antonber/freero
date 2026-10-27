// Pure tree helpers over mind-map nodes (unit-tested). A node's tree is defined by `parentId`
// links; `rootId` is a denormalized hint only. Everything here is cycle-safe: a broken or
// cyclic chain makes the affected nodes orphans (hidden), never an infinite loop.

export type Direction = 'right' | 'left' | 'both';
export type Side = 'right' | 'left';

/** The geometric/structural slice of a MindmapElement the algorithms need. */
export interface MindNode {
  id: string;
  parentId: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  collapsed?: boolean;
  direction?: Direction;
  createdAt: number;
}

export interface TreeIndex<N extends MindNode = MindNode> {
  byId: Map<string, N>;
  /** Children by parent id, in sibling order (top to bottom). */
  kids: Map<string, N[]>;
}

const cy = (n: MindNode) => n.y + n.h / 2;
export const cx = (n: MindNode) => n.x + n.w / 2;

/** Sibling order: top to bottom, ties by creation. Layout preserves it, so it is stable. */
export function compareSiblings(a: MindNode, b: MindNode): number {
  return cy(a) - cy(b) || a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function indexNodes<N extends MindNode>(nodes: readonly N[]): TreeIndex<N> {
  const byId = new Map<string, N>();
  const kids = new Map<string, N[]>();
  for (const n of nodes) byId.set(n.id, n);
  for (const n of nodes) {
    if (!n.parentId) continue;
    const list = kids.get(n.parentId);
    if (list) list.push(n);
    else kids.set(n.parentId, [n]);
  }
  for (const list of kids.values()) list.sort(compareSiblings);
  return { byId, kids };
}

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

/** Which side of its parent a node sits on (decided by position, so it survives drags). */
export function sideOf(node: MindNode, parent: MindNode): Side {
  return cx(node) < cx(parent) ? 'left' : 'right';
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
}

export function computeInfo(index: TreeIndex): Map<string, NodeInfo> {
  const out = new Map<string, NodeInfo>();
  const visit = (n: MindNode, root: string, depth: number, hidden: boolean): number => {
    if (out.has(n.id)) return 0; // cycle guard
    const info: NodeInfo = { hidden, root, depth, childCount: 0, descendantCount: 0, kidsRight: false, kidsLeft: false };
    out.set(n.id, info);
    const ks = index.kids.get(n.id) ?? [];
    info.childCount = ks.length;
    let count = 0;
    for (const k of ks) {
      if (sideOf(k, n) === 'left') info.kidsLeft = true;
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
      out.set(n.id, { hidden: true, root: null, depth: 0, childCount: 0, descendantCount: 0, kidsRight: false, kidsLeft: false });
  return out;
}

/** Ids of nodes whose ancestor chain no longer reaches a root (left behind by a plain delete). */
export function orphanIds(index: TreeIndex): string[] {
  const out: string[] = [];
  for (const n of index.byId.values()) if (n.parentId && !rootOf(index, n.id)) out.push(n.id);
  return out;
}
