// The in-progress stroke lives here, outside the board doc: it is rendered by the tool's
// Preview on every pointer move and committed to the doc once, on pointer-up.
import { useSyncExternalStore } from 'react';
import type { RawPoint } from './stroke';

export interface Draft {
  points: RawPoint[];
  color: string;
  width: number;
  highlighter: boolean;
  /** Last captured screen position and pressure (for spacing + simulated pressure). */
  lastScreen: { x: number; y: number };
  realPressure: boolean;
}

let draft: Draft | null = null;
let version = 0;
const listeners = new Set<() => void>();
let frame: number | null = null;

function emit() {
  version++;
  for (const l of listeners) l();
}

export function getDraft(): Draft | null {
  return draft;
}

export function startDraft(d: Draft) {
  draft = d;
  emit();
}

/** Points were appended: notify at most once per animation frame. */
export function touchDraft() {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    emit();
  });
}

export function clearDraft() {
  draft = null;
  if (frame !== null) {
    cancelAnimationFrame(frame);
    frame = null;
  }
  emit();
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/** Re-renders on every draft change; returns the version so memoization keys change. */
export function useDraftVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}
