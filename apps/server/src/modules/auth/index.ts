// Public API of modules/auth. Other modules import only this file [S2].
export {
  requireUser,
  currentUser,
  getUser,
  getUsers,
  createUser,
  findUserByEmail,
  userFromCookieHeader,
  sessionKeyFromCookieHeader,
  onSessionEnd,
} from './service';
