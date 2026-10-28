// Public API of modules/auth. Other modules import only this file [S2].
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import {
  lastActiveOf,
  matchesInAvatars,
  twoFactorEnabled,
  twoFactorEnabledAmong,
  updateUserProfile,
  userIdsAtDomain as repoUserIdsAtDomain,
} from './repo';

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
  onSessionEnd,
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
// Workspace single sign-on (modules/sso) and provisioning (SCIM): the generic OpenID Connect
// client, the account rules for a workspace's identity provider, the one way to finish a sign-in
// (second step, sessions, notices), and the restriction seam "Enforce SSO" registers with.
export {
  authorizationUrl as oidcAuthorizationUrl,
  redeemAuthorizationCode as redeemOidcCode,
  newAuthorizationChecks as newOidcChecks,
  OidcUnavailableError,
  type OidcClientConfig,
  type ProviderClaims,
} from './oidc';
export { completeSignIn, safeReturnPath } from './signIn';
export { resolveDirectoryLogin, provisionDirectoryAccount, DIRECTORY_PROVIDER_PREFIX } from './providers';
export { onSignInRestriction, type SignInAttempt, type SignInRestriction } from './restrictions';
export { endSessionsOf } from './service';
export { exportAccountData, type AccountDataExport } from './dataExport';

/** Ids of the accounts whose address is at `domain` (exactly). */
export function userIdsAtDomain(domain: string): Promise<string[]> {
  return repoUserIdsAtDomain(domain.toLowerCase());
}

/** A directory (SCIM) renamed the person: the account's display name follows. */
export async function setAccountName(userId: string, name: string): Promise<void> {
  const clean = name.trim().slice(0, 80);
  if (clean) await updateUserProfile(userId, { name: clean });
}
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
