// In-process events of modules/boards, for modules that react to what happens to a board as a
// whole (the activity feed, KAI-188). Fired after the change is committed; a listener's failure is
// logged and never fails the change.
import { logError } from '../../platform/log';

export type BoardLifecycleAction = 'created' | 'duplicated' | 'renamed' | 'moved' | 'trashed' | 'restored';

export interface BoardLifecycleEvent {
  boardId: string;
  /** Who did it. */
  actorId: string;
  action: BoardLifecycleAction;
  /**
   * renamed: the old and new title; moved: the project's name (`to`, null = out of every project);
   * duplicated: the title of the board it is a copy of (`from`; the event is about the copy).
   */
  from?: string | null;
  to?: string | null;
}

type Listener = (e: BoardLifecycleEvent) => Promise<void> | void;
const listeners = new Set<Listener>();

export function onBoardLifecycle(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function boardLifecycle(e: BoardLifecycleEvent): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(e);
    } catch (err) {
      logError('boards: a lifecycle listener failed', err);
    }
  }
}
