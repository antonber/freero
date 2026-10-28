// Public API of modules/auth. Other modules import only this file [S2].
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import { matchesInAvatars } from './repo';

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
export { accountsDueForPurge, deleteAccountIfDue, isDueForPurge, scheduleAccountDeletion, restoreAccount } from './account';

/** Upload names used as profile pictures (restricted to `among` when given): the uploads sweep keeps them. */
export function avatarUploadReferences(among?: readonly string[]): Promise<string[]> {
  return matchesInAvatars(UPLOAD_REF_PATTERN, among ?? null);
}
