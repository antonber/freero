// What the mind-map `follow` hook rewrites after a LOCAL change (pure, unit-tested).
//
// The engine calls ElementDefinition.follow inside the transaction of every local
// update/updateMany/remove, so whatever we return lands in the same undo step and network
// update, and remote clients never rewrite it:
//   - while the local user drags nodes, the descendants of each dragged node are laid out
//     relative to it (the branch travels as one piece, siblings stay put);
//   - otherwise any change to a map's nodes (text grew a node, a node was deleted from the
//     context menu, …) re-lays out that whole map.
import type { Point } from '@engine';
import { layoutBranch, layoutTree } from './layout';
import { indexNodes, rootOf, type MindNode } from './tree';

export interface FollowInput {
  /** Current (post-change) nodes. */
  nodes: MindNode[];
  changed: ReadonlySet<string>;
  removed: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  /** The local user is dragging with the select tool. */
  dragging: boolean;
  /** Root a node belonged to before this change (needed for nodes that were just removed). */
  previousRoot(id: string): string | null;
}

export function planFollow(input: FollowInput): Map<string, Point> {
  const out = new Map<string, Point>();
  const index = indexNodes(input.nodes);
  if (![...input.changed].some((id) => index.byId.has(id)) && !input.removed.size) return out;

  if (input.dragging) {
    const anchors = new Set([...input.changed].filter((id) => index.byId.has(id) && input.selected.has(id)));
    for (const a of anchors) {
      // Only the top-most dragged node of a branch carries it.
      let p = index.byId.get(a)!.parentId;
      const seen = new Set<string>();
      let nested = false;
      while (p && !seen.has(p)) {
        if (anchors.has(p)) nested = true;
        seen.add(p);
        p = index.byId.get(p)?.parentId ?? null;
      }
      if (nested) continue;
      for (const [id, pos] of layoutBranch(index, a)) if (id !== a) out.set(id, pos);
    }
    return out;
  }

  const roots = new Set<string>();
  for (const id of input.changed) {
    if (!index.byId.has(id)) continue;
    const r = rootOf(index, id);
    if (r) roots.add(r.id);
  }
  for (const id of input.removed) {
    const r = input.previousRoot(id);
    if (r && index.byId.has(r)) roots.add(r);
  }
  for (const r of roots) for (const [id, pos] of layoutTree(index, r)) out.set(id, pos);
  return out;
}
