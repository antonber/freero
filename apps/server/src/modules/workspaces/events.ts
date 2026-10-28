// In-process events of modules/workspaces, for modules that keep things per workspace member
// (templates shared with a team stop being shared when their owner leaves it).
import type { WorkspaceRole } from '@freero/shared';
import { logError } from '../../platform/log';

export interface MembershipChangedEvent {
  workspaceId: string;
  userId: string;
  /** Their role now; null when they are no longer in the workspace. */
  role: WorkspaceRole | null;
}

type Listener = (e: MembershipChangedEvent) => Promise<void> | void;
const listeners = new Set<Listener>();

/** Someone left / was removed from a workspace, or their role in it changed (after it committed). */
export function onMembershipChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function membershipChanged(e: MembershipChangedEvent): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(e);
    } catch (err) {
      logError('workspaces: a membership listener failed', err);
    }
  }
}
