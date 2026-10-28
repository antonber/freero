// Public API of modules/auth. Other modules import only this file [S2].
export {
  requireUser,
  currentUser,
  getUser,
  getUsers,
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
export { accountsDueForPurge, deleteAccountIfDue, isDueForPurge, scheduleAccountDeletion, restoreAccount } from './account';
