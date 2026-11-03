// In-process events of modules/boards, for modules that react to what happens to a board as a
// whole (the activity feed, KAI-188). Fired after the change is committed; a listener's failure is
// logged and never fails the change.
import type { MoveAdjustment } from '@freero/shared';
import { logError } from '../../platform/log';

export type BoardLifecycleAction = 'created' | 'duplicated' | 'renamed' | 'moved' | 'moved_workspace' | 'trashed' | 'restored';

export interface BoardLifecycleEvent {
  boardId: string;
  /** Who did it. */
  actorId: string;
  action: BoardLifecycleAction;
  /**
   * renamed: the old and new title; moved: the project's name (`to`, null = out of every project),
   * moved_workspace (#124): the workspace's name (`to`);
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

/** A board moved into another workspace (#124), after the move committed. */
export interface BoardMovedWorkspaceEvent {
  boardId: string;
  actorId: string;
  fromWorkspaceId: string;
  toWorkspaceId: string;
}
type MoveListener = (e: BoardMovedWorkspaceEvent) => Promise<MoveAdjustment[] | void> | MoveAdjustment[] | void;
const moveListeners = new Set<MoveListener>();

/**
 * Modules that keep something per workspace for a board adjust it here when the board moves to
 * another workspace (trackers pause issues linked through the old workspace's connections), and
 * say what they turned off (shown to the person who moved it). A failure is logged, never fails the move.
 */
export function onBoardMovedWorkspace(fn: MoveListener): () => void {
  moveListeners.add(fn);
  return () => moveListeners.delete(fn);
}

export async function boardMovedWorkspace(e: BoardMovedWorkspaceEvent): Promise<MoveAdjustment[]> {
  const out: MoveAdjustment[] = [];
  for (const fn of moveListeners) {
    try {
      out.push(...((await fn(e)) ?? []));
    } catch (err) {
      logError('boards: a move listener failed', err);
    }
  }
  return out;
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
