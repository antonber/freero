// Seam for retention policies and legal holds (KAI-51): a module that must keep a workspace's data
// registers a check here; deleting the workspace is refused while any check names a hold. Today no
// module registers one, so deletion proceeds; the order of checks is irrelevant (any hold refuses).
import { logError } from '../../platform/log';

/** Returns why the workspace must be kept ("Legal hold: case 123"), or null. */
export type DeletionHoldCheck = (workspaceId: string) => Promise<string | null> | string | null;

const checks = new Set<DeletionHoldCheck>();

export function onWorkspaceDeletionHold(fn: DeletionHoldCheck): () => void {
  checks.add(fn);
  return () => checks.delete(fn);
}

/** The first hold on the workspace, or null. A failing check counts as a hold (fail closed). */
export async function deletionHoldOn(workspaceId: string): Promise<string | null> {
  for (const fn of checks) {
    try {
      const reason = await fn(workspaceId);
      if (reason) return reason;
    } catch (e) {
      logError('workspaces: a deletion-hold check failed; keeping the workspace', e);
      return 'Its data retention could not be checked. Try again later.';
    }
  }
  return null;
}
