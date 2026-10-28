// Phone layout (KAI-139): below this width the board opens "view and comment first" — the toolbar
// becomes a bottom bar with only the tools a viewer or commenter has (select, hand, comment), the
// format toolbar stays hidden, and side panels open as a bottom sheet. Editors switch to the full
// toolbar with its "Edit" button (UiState.phoneEditing; local, never synced).
import { useSyncExternalStore } from 'react';

export const COMPACT_QUERY = '(max-width: 600px)';

const query = () => (typeof matchMedia === 'function' ? matchMedia(COMPACT_QUERY) : null);

function subscribe(cb: () => void): () => void {
  const q = query();
  if (!q) return () => undefined;
  q.addEventListener('change', cb);
  return () => q.removeEventListener('change', cb);
}

/** True on a phone-sized window (re-renders when it crosses the breakpoint). */
export function useCompactLayout(): boolean {
  return useSyncExternalStore(subscribe, () => !!query()?.matches, () => false);
}
