// Account deletion: a grace period during which the owner can sign in and restore the account,
// then a purge (modules/accounts) that removes everything. Scheduling ends every session at once.
import type { Request } from 'express';
import type { Account, User } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError } from '../../platform/http';
import { sendSecurityNotice } from './notices';
import * as repo from './repo';
import { confirmPassword, endSessionsOf, getAccount, publicUser } from './service';

export async function scheduleAccountDeletion(req: Request | null, userId: string, password: unknown, sessionAuthAt?: number): Promise<number> {
  const user = await confirmPassword(userId, password, sessionAuthAt);
  const at = Date.now() + getConfig().accountDeletionGraceMs;
  await repo.scheduleDeletion(userId, at);
  await endSessionsOf(userId);
  sendSecurityNotice(req, user.email, { kind: 'deletion_scheduled', at });
  return at;
}

export async function restoreAccount(userId: string): Promise<Account> {
  if (!(await repo.cancelDeletion(userId))) throw new HttpError(409, 'This account is not scheduled for deletion');
  return getAccount(userId);
}

/** Accounts whose grace period is over, oldest first. */
export async function accountsDueForPurge(now: number, limit = 50): Promise<User[]> {
  return (await repo.usersDueForPurge(now, limit)).map(publicUser);
}

/** Hard-deletes the account row if it is still due (a restore may have won). Cascades in the database. */
export function deleteAccountIfDue(userId: string, now: number): Promise<boolean> {
  return repo.deleteUserIfDue(userId, now);
}

/** Still scheduled and past its grace period (re-checked by the purge before each destructive step). */
export async function isDueForPurge(userId: string, now: number): Promise<boolean> {
  const u = await repo.findUserById(userId);
  return !!u && u.deletionScheduledFor !== null && u.deletionScheduledFor <= now;
}
