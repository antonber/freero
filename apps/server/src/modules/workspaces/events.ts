// Events of modules/workspaces, for modules that keep things per workspace member (templates
// shared with a team stop being shared when their owner leaves it or becomes a guest there).
//
// Reliable: a membership change appends a `workspace.membership` OUTBOX event in its own
// transaction (platform/outbox.ts), so a consumer hears of every committed change even when the
// process dies right after the commit. Consumers re-read the person's CURRENT role (the event only
// says "look again"). The in-process `onMembershipChanged` stays for live, best-effort reactions.
import type { WorkspaceRole } from '@freero/shared';
import { logError } from '../../platform/log';
import { appendOutbox } from '../../platform/outbox';

/** Outbox topic: someone's membership of a workspace changed (payload `{ workspaceId, userId }`). */
export const WORKSPACE_MEMBERSHIP_TOPIC = 'workspace.membership';

/** Call inside the transaction that changes the membership (role, removal). */
export function recordMembershipChange(workspaceId: string, userId: string): Promise<void> {
  return appendOutbox(WORKSPACE_MEMBERSHIP_TOPIC, `workspace:${workspaceId}:${userId}`, { workspaceId, userId });
}

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
