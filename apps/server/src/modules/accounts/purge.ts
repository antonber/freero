// Hard deletion of accounts whose grace period is over. Every instance schedules it; a Postgres
// advisory lock lets one run at a time. Each step is idempotent, so a purge interrupted halfway
// (crash, deploy) is simply finished by the next run:
//   1. team workspaces they solely own get a new owner (or, empty, are deleted with their boards),
//      and boards they own in team workspaces pass to an owner there (workspaces.handOverTeamWorkspaces);
//      the boards they still own (their personal workspace's, trash included) are deleted;
//   2. on boards they could comment on (member or opened), their comments become "Deleted user";
//   3. their avatar file is deleted;
//   4. the account row goes; sessions, tokens, memberships, stars, opens, invites, upload rows and
//      the personal workspace cascade — except files an operator removed, which outlive it.
// Before step 1 the account is re-checked, so a restore that lands first keeps everything.
// Legal hold (KAI-178): while the account owns a board an operator took down (or is the last
// member of a team holding one), the purge waits after the hand-over — nothing is deleted — until
// an operator restores the board or deletes it for good; the account stays signed out meanwhile.
// Other files they uploaded are not deleted here: images they placed on other people's boards stay
// part of those boards, and files nothing references any more are removed by the uploads sweep.
import { runExclusive } from '../../platform/jobs';
import { log, logError } from '../../platform/log';
import { accountsDueForPurge, deleteAccountIfDue, getUser, isDueForPurge } from '../auth/index';
import { boardIdsOpenedBy, countHeldBoards, deleteBoardsOwnedBy, forgetLinkUnlocksOf } from '../boards/index';
import { membershipsOf } from '../members/index';
import { forgetEngageRespondent } from '../engage/index';
import { renameCommentAuthor } from '../realtime/index';
import { deleteUpload, keepRemovedUploadsOf } from '../uploads/index';
import { auditScopeOf, handOverTeamWorkspaces } from '../workspaces/index';
import { recordAuditQuietly } from '../audit/index';

export const PURGE_LOCK_KEY = 7_202_610_281; // arbitrary, constant across releases
export const DELETED_USER_NAME = 'Deleted user';
export const DELETED_USER_COLOR = '#868E96';

/**
 * Purges one account (if still due). Safe to repeat. 'held': it waits for boards held for
 * moderation review (see above).
 */
export async function purgeAccount(userId: string, now: number): Promise<boolean | 'held'> {
  if (!(await isDueForPurge(userId, now))) return false;
  const commentedOn = new Set([...(await membershipsOf(userId)).keys(), ...(await boardIdsOpenedBy(userId))]);
  const teams = await auditScopeOf(userId); // before the memberships go with the account
  const email = (await getUser(userId))?.email ?? null;
  const { held: heldTeams } = await handOverTeamWorkspaces(userId);
  const held = heldTeams + (await countHeldBoards({ ownerId: userId }));
  if (held) {
    log(`accounts: purge of ${userId} waits for ${held} board(s) or workspace(s) held for moderation review`);
    return 'held';
  }
  const deletedBoards = await deleteBoardsOwnedBy(userId);
  for (const boardId of commentedOn) {
    try {
      await renameCommentAuthor(boardId, userId, DELETED_USER_NAME, DELETED_USER_COLOR);
    } catch (e) {
      // Leave the account in place: the next run retries the whole (idempotent) purge.
      throw new Error(`could not anonymize comments on board ${boardId}`, { cause: e });
    }
  }
  await forgetEngageRespondent(userId);
  await forgetLinkUnlocksOf(userId);
  await deleteUpload((await getUser(userId))?.avatarUrl);
  await keepRemovedUploadsOf(userId);
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
  const held: string[] = []; // waiting for a review: never block the accounts behind them
  for (;;) {
    const due = await accountsDueForPurge(now, 50, held);
    if (due.length === 0) return purged;
    let progressed = false;
    for (const u of due) {
      try {
        const done = await purgeAccount(u.id, now);
        if (done === 'held') {
          held.push(u.id);
          progressed = true;
        } else if (done) {
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
