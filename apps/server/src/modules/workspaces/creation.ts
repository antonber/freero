// Seam for who may create a TEAM workspace (#64): a module that manages people's accounts beyond
// this one registers a check. Single sign-on's domain control does: with "Block other team
// workspaces" on, people at a workspace's verified domain can't start their own. The check records
// its own refusal (the audit log of the workspace that manages them); a failing check refuses
// (fail closed). Personal workspaces are not affected: each account has exactly one.
import { logError } from '../../platform/log';

/** Why this person may not create a team workspace (shown to them), or null. */
export type CreationCheck = (userId: string, name: string) => Promise<string | null> | string | null;

const checks = new Set<CreationCheck>();

export function onTeamWorkspaceCreation(fn: CreationCheck): () => void {
  checks.add(fn);
  return () => checks.delete(fn);
}

export async function creationRefusal(userId: string, name: string): Promise<string | null> {
  for (const fn of checks) {
    try {
      const reason = await fn(userId, name);
      if (reason) return reason;
    } catch (e) {
      logError('workspaces: a creation check failed; refusing the new workspace', e);
      return 'Creating a workspace is unavailable right now. Please try again in a moment.';
    }
  }
  return null;
}
