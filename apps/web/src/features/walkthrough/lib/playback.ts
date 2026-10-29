// Which walkthrough this tab is watching (one at a time). The player overlay owns the media element
// and the clock; this store only says what to play and from where.
import { useSyncExternalStore } from 'react';
import type { Walkthrough } from '@freero/shared';
import type { Editor } from '@engine';

export interface PlayerState {
  walkthrough: Walkthrough | null;
  loading: boolean;
  /** Where to start (ms), e.g. from a notification about a comment at that moment. */
  startAt: number;
  /** Bumped on every open, so opening the same walkthrough again restarts it. */
  session: number;
}

let state: PlayerState = { walkthrough: null, loading: false, startAt: 0, session: 0 };
const listeners = new Set<() => void>();
const set = (patch: Partial<PlayerState>) => {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
};

export function usePlayer(): PlayerState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'This walkthrough couldn’t be opened.');

export async function openWalkthrough(editor: Editor, id: string, startAt = 0): Promise<void> {
  const host = editor.host.walkthroughs;
  if (!host) return editor.host.notify('Walkthroughs need a Freero server.', 'info');
  const session = state.session + 1;
  set({ loading: true, session });
  try {
    const walkthrough = await host.get(id);
    if (state.session !== session) return;
    set({ walkthrough, loading: false, startAt: Math.max(0, Math.min(startAt, walkthrough.durationMs - 100)) });
  } catch (e) {
    if (state.session === session) set({ loading: false });
    editor.host.notify(message(e), 'error');
  }
}

/** Replaces the walkthrough being watched (after captions or a rename) without restarting it. */
export function updateWalkthrough(w: Walkthrough): void {
  if (state.walkthrough?.id === w.id) set({ walkthrough: w });
}

export function closeWalkthrough(): void {
  set({ walkthrough: null, loading: false, startAt: 0, session: state.session + 1 });
}
