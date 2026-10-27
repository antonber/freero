// Derived per-node tree info (hidden, child counts, hub sides) shared by node views, hit-testing
// and the controller. Maintained by the controller (panel.tsx) from the elements map; node views
// subscribe to their own id only, so one change re-renders only the nodes whose info changed.
import { useCallback, useSyncExternalStore } from 'react';
import type { NodeInfo } from './tree';

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
  for (const id of prev.keys()) if (!next.has(id)) changed.push(id);
  infos = merged;
  for (const id of changed) notify(id);
}

export function getInfo(id: string): NodeInfo {
  return infos.get(id) ?? DEFAULT;
}

export function isHidden(id: string): boolean {
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
