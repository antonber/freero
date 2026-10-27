// Public API of modules/auth. Other modules import only this file [S2].
export {
  requireUser,
  currentUser,
  getUser,
  findUserByEmail,
  userFromCookieHeader,
  sessionKeyFromCookieHeader,
  onSessionEnd,
} from './service';
