// Derived per-node tree info (hidden, child counts, hub sides) shared by node views, the
// definition's `hidden` / `removeWith`, and the controller. Recomputed lazily whenever the
// board's element list changed (syncTree), so reads are never stale — also mid-transaction.
// Node views subscribe to their own id only: one change re-renders only nodes whose info changed.
import { useCallback, useSyncExternalStore } from 'react';
import type { BoardElement, MindmapElement } from '@freero/shared';
import type { Editor } from '@engine';
import { computeInfo, indexNodes, type NodeInfo, type TreeIndex } from './tree';

const DEFAULT: NodeInfo = Object.freeze({
  hidden: false,
  root: null,
  depth: 0,
  childCount: 0,
  descendantCount: 0,
  kidsRight: false,
  kidsLeft: false,
});

let infos = new Map<string, NodeInfo>();
/** Root of nodes that just left the map (deleted): the follow hook re-lays out what they left. */
const lastRoot = new Map<string, string>();
let source: readonly BoardElement[] | null = null;
let tree: TreeIndex<MindmapElement> = indexNodes<MindmapElement>([]);
let dropTarget: string | null = null;
let dragging = false;

/** True while the LOCAL user is dragging on the canvas with the select tool (set by the controller). */
export const isDragging = () => dragging;
export function setDragging(v: boolean) {
  dragging = v;
}
const listeners = new Map<string, Set<() => void>>();

const same = (a: NodeInfo, b: NodeInfo) =>
  a.hidden === b.hidden &&
  a.root === b.root &&
  a.depth === b.depth &&
  a.childCount === b.childCount &&
  a.descendantCount === b.descendantCount &&
  a.kidsLeft === b.kidsLeft &&
  a.kidsRight === b.kidsRight;

function notify(id: string) {
  const set = listeners.get(id);
  if (set) for (const l of [...set]) l();
}

export function setInfos(next: Map<string, NodeInfo>) {
  const prev = infos;
  const merged = new Map<string, NodeInfo>();
  const changed: string[] = [];
  for (const [id, info] of next) {
    const old = prev.get(id);
    if (old && same(old, info)) merged.set(id, old);
    else {
      merged.set(id, info);
      changed.push(id);
    }
  }
  for (const [id, old] of prev) {
    if (next.has(id)) continue;
    changed.push(id);
    if (old.root) lastRoot.set(id, old.root);
  }
  if (lastRoot.size > 5000) lastRoot.clear();
  infos = merged;
  for (const id of changed) notify(id);
}

/** Brings the tree index + infos up to date with the board (cheap when nothing changed). */
export function syncTree(editor: Editor): TreeIndex<MindmapElement> {
  const els = editor.getElements();
  if (els !== source) {
    source = els;
    tree = indexNodes(els.filter((el): el is MindmapElement => el.type === 'mindmap'));
    setInfos(computeInfo(tree));
  }
  return tree;
}

/** Forget the board (controller unmount). */
export function resetTree() {
  source = null;
  tree = indexNodes<MindmapElement>([]);
  setInfos(new Map());
}

export function getInfo(id: string): NodeInfo {
  return infos.get(id) ?? DEFAULT;
}

/** The root `id` hangs from — or hung from, if it was just deleted. */
export function rootIdOf(id: string): string | null {
  return infos.get(id)?.root ?? lastRoot.get(id) ?? null;
}

/** Under a collapsed node, or orphaned (its parent is gone). */
export function isHidden(editor: Editor, id: string): boolean {
  syncTree(editor);
  return infos.get(id)?.hidden ?? false;
}

export function setDropTarget(id: string | null) {
  if (id === dropTarget) return;
  const prev = dropTarget;
  dropTarget = id;
  if (prev) notify(prev);
  if (id) notify(id);
}

function subscribe(id: string, cb: () => void): () => void {
  let set = listeners.get(id);
  if (!set) listeners.set(id, (set = new Set()));
  set.add(cb);
  return () => {
    set!.delete(cb);
    if (!set!.size) listeners.delete(id);
  };
}

export function useNodeInfo(id: string): NodeInfo {
  const sub = useCallback((cb: () => void) => subscribe(id, cb), [id]);
  return useSyncExternalStore(sub, () => getInfo(id));
}

export function useIsDropTarget(id: string): boolean {
  const sub = useCallback((cb: () => void) => subscribe(id, cb), [id]);
  return useSyncExternalStore(sub, () => dropTarget === id);
}
