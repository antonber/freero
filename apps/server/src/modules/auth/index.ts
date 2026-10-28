// Public API of modules/auth. Other modules import only this file [S2].
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import { lastActiveOf, matchesInAvatars, twoFactorEnabled, twoFactorEnabledAmong } from './repo';

export {
  requireUser,
  currentUser,
  getUser,
  getUsers,
  getAccount,
  createUser,
  findUserByEmail,
  normalizeEmail,
  userFromCookieHeader,
  sessionKeyFromCookieHeader,
  // Live connections (board sockets, notification bells): closed when their session ends, also
  // when it ended in another process or silently (KAI-146).
  onSessionEnd,
  trackLiveSessions,
  onEmailVerified,
  markEmailVerified,
  // Operators (modules/moderation): suspended accounts can't sign in and lose every session.
  suspendUser,
  unsuspendUser,
  isSuspended,
  suspendedUserIds,
} from './service';
// A workspace policy requiring two-step verification registers here (Enterprise).
export { onTwoFactorRequirement } from './twoFactor';
// Workspace session policies (KAI-51): where a person's limits come from, the enforcement job,
// and activity that doesn't come through REST (board sockets).
export { setSessionLimits, endSessionsBeyondLimits, noteSessionActivity, type SessionLimits } from './service';

/** Whether the user has two-step verification on (workspace policies that require it). */
export function hasTwoFactor(userId: string): Promise<boolean> {
  return twoFactorEnabled(userId);
}

/** For the admin console: who of these people has two-step verification on, and when each was last active. */
export async function securityStatusOf(userIds: string[]): Promise<{ twoFactor: Set<string>; lastActive: Map<string, number> }> {
  const [twoFactor, lastActive] = await Promise.all([twoFactorEnabledAmong(userIds), lastActiveOf(userIds, Date.now())]);
  return { twoFactor, lastActive };
}
export { accountsDueForPurge, deleteAccountIfDue, isDueForPurge, scheduleAccountDeletion, restoreAccount } from './account';

/** Upload names used as profile pictures (restricted to `among` when given): the uploads sweep keeps them. */
export function avatarUploadReferences(among?: readonly string[]): Promise<string[]> {
  return matchesInAvatars(UPLOAD_REF_PATTERN, among ?? null);
}
