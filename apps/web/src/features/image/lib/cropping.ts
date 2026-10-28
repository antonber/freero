// Which image this tab is cropping right now (local UI state, never synced): the element hides
// itself while the crop overlay draws the whole picture in its place.
import { useSyncExternalStore } from 'react';

export const CROP_PANEL = 'image.crop';

let cropping: string | null = null;
const listeners = new Set<() => void>();

export function setCropping(id: string | null): void {
  if (cropping === id) return;
  cropping = id;
  listeners.forEach((l) => l());
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

export function useIsCropping(id: string): boolean {
  return useSyncExternalStore(subscribe, () => cropping === id);
}
