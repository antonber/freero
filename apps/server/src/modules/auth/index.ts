// Public API of modules/auth. Other modules import only this file [S2].
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
export { accountsDueForPurge, deleteAccountIfDue, isDueForPurge, scheduleAccountDeletion, restoreAccount } from './account';
