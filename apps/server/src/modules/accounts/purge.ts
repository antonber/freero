// Hard deletion of accounts whose grace period is over. Every instance schedules it; a Postgres
// advisory lock lets one run at a time. Each step is idempotent, so a purge interrupted halfway
// (crash, deploy) is simply finished by the next run:
//   1. team workspaces they solely own get a new owner (or, empty, are deleted with their boards),
//      and boards they own in team workspaces pass to an owner there (workspaces.handOverTeamWorkspaces);
//      the boards they still own (their personal workspace's, trash included) are deleted;
//   2. on boards they could comment on (member or opened), their comments become "Deleted user";
//   3. their avatar file is deleted;
//   4. the account row goes; sessions, tokens, memberships, stars, opens, invites, upload rows and
//      the personal workspace cascade.
// Before step 1 the account is re-checked, so a restore that lands first keeps everything.
// Other files they uploaded are not deleted here: images they placed on other people's boards stay
// part of those boards, and files nothing references any more are removed by the uploads sweep.
import { runExclusive } from '../../platform/jobs';
import { log, logError } from '../../platform/log';
import { accountsDueForPurge, deleteAccountIfDue, getUser, isDueForPurge } from '../auth/index';
import { boardIdsOpenedBy, deleteBoardsOwnedBy } from '../boards/index';
import { membershipsOf } from '../members/index';
import { renameCommentAuthor } from '../realtime/index';
import { deleteUpload } from '../uploads/index';
import { auditScopeOf, handOverTeamWorkspaces } from '../workspaces/index';
import { recordAuditQuietly } from '../audit/index';

export const PURGE_LOCK_KEY = 7_202_610_281; // arbitrary, constant across releases
export const DELETED_USER_NAME = 'Deleted user';
export const DELETED_USER_COLOR = '#868E96';

/** Purges one account (if still due). Safe to repeat. */
export async function purgeAccount(userId: string, now: number): Promise<boolean> {
  if (!(await isDueForPurge(userId, now))) return false;
  const commentedOn = new Set([...(await membershipsOf(userId)).keys(), ...(await boardIdsOpenedBy(userId))]);
  const teams = await auditScopeOf(userId); // before the memberships go with the account
  const email = (await getUser(userId))?.email ?? null;
  await handOverTeamWorkspaces(userId);
  const deletedBoards = await deleteBoardsOwnedBy(userId);
  for (const boardId of commentedOn) {
    try {
      await renameCommentAuthor(boardId, userId, DELETED_USER_NAME, DELETED_USER_COLOR);
    } catch (e) {
      // Leave the account in place: the next run retries the whole (idempotent) purge.
      throw new Error(`could not anonymize comments on board ${boardId}`, { cause: e });
    }
  }
  await deleteUpload((await getUser(userId))?.avatarUrl);
  const deleted = await deleteAccountIfDue(userId, now);
  if (deleted) {
    log(`accounts: purged account ${userId} (${deletedBoards} boards)`);
    const target = { type: 'user', id: userId, label: email };
    await recordAuditQuietly({ action: 'account.deleted', accountId: userId, fanOut: false, actorId: null, target, metadata: { boards: deletedBoards } });
    for (const workspaceId of teams) await recordAuditQuietly({ action: 'account.deleted', workspaceId, actorId: null, target });
  }
  return deleted;
}

/**
 * Purges every account due at `now`, unless another instance is already purging (then returns
 * null). Returns how many accounts were removed.
 */
export function purgeDueAccounts(now = Date.now()): Promise<number | null> {
  return runExclusive(PURGE_LOCK_KEY, () => purgeDueLocked(now));
}

/** The purge itself; the caller holds PURGE_LOCK_KEY (purgeDueAccounts, or the scheduled job). */
export async function purgeDueLocked(now = Date.now()): Promise<number> {
  let purged = 0;
  for (;;) {
    const due = await accountsDueForPurge(now, 50);
    if (due.length === 0) return purged;
    let progressed = false;
    for (const u of due) {
      try {
        if (await purgeAccount(u.id, now)) {
          purged++;
          progressed = true;
        }
      } catch (e) {
        logError(`accounts: purge of ${u.id} failed; retrying on the next run`, e);
      }
    }
    if (!progressed) return purged; // only failures left: don't spin
  }
}
