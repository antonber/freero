// Local-only placeholders for files that are still uploading, drawn by the world-overlay panel
// (never written to the board): the items are created once, with their final URLs — one undo
// step and nothing half-finished for collaborators.
import { useSyncExternalStore } from 'react';
import type { Rect } from '@engine';

export interface Pending {
  rect: Rect;
  name: string;
}

let pending: Pending[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function addPending(items: Pending[]): () => void {
  pending = [...pending, ...items];
  emit();
  return () => {
    pending = pending.filter((p) => !items.includes(p));
    emit();
  };
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function usePending(): Pending[] {
  return useSyncExternalStore(subscribe, () => pending);
}
