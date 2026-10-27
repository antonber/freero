// Local-only placeholders for images that are still uploading. They are drawn by the
// world-overlay panel (never written to the board), so the element itself is created once,
// with its final URL — one undo step and no half-finished elements for collaborators.
import { useSyncExternalStore } from 'react';
import type { Rect } from '@engine';

let pending: Rect[] = [];
const listeners = new Set<() => void>();

const emit = () => listeners.forEach((l) => l());

export function addPending(rects: Rect[]): () => void {
  pending = [...pending, ...rects];
  emit();
  return () => {
    pending = pending.filter((r) => !rects.includes(r));
    emit();
  };
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function usePending(): Rect[] {
  return useSyncExternalStore(subscribe, () => pending);
}
