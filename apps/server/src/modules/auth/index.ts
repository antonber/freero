// Public API of modules/auth. Other modules import only this file [S2].
import { UPLOAD_REF_PATTERN } from '../uploads/index';
import { matchesInAvatars } from './repo';

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
// Guests: visitors without an account on one board's shared link (boards decides who may join).
export {
  startGuestSession,
  guestFromCookieHeader,
  guestKeyFromCookieHeader,
  getGuests,
  endGuestSession,
  requireUserOrGuest,
  currentActor,
  actorId,
  cleanGuestName,
  type Actor,
} from './guests';
// A workspace policy requiring two-step verification registers here (Enterprise).
export { onTwoFactorRequirement } from './twoFactor';
export { accountsDueForPurge, deleteAccountIfDue, isDueForPurge, scheduleAccountDeletion, restoreAccount } from './account';

/** Upload names used as profile pictures (restricted to `among` when given): the uploads sweep keeps them. */
export function avatarUploadReferences(among?: readonly string[]): Promise<string[]> {
  return matchesInAvatars(UPLOAD_REF_PATTERN, among ?? null);
}
