// Public API of modules/auth. Other modules import only this file [S2].
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import { matchesInAvatars, updateUserProfile, userIdsAtDomain as repoUserIdsAtDomain } from './repo';

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
export { accountsDueForPurge, deleteAccountIfDue, isDueForPurge, scheduleAccountDeletion, restoreAccount } from './account';

/** Upload names used as profile pictures (restricted to `among` when given): the uploads sweep keeps them. */
export function avatarUploadReferences(among?: readonly string[]): Promise<string[]> {
  return matchesInAvatars(UPLOAD_REF_PATTERN, among ?? null);
}
