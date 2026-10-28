// Public API of modules/uploads [S2].
export { saveUpload, deleteUpload, uploadBytesUsed, contentMatches, UPLOAD_REF_PATTERN, uploadNamesIn } from './store';
// Data exports (modules/privacy): archives kept out of /uploads and the sweep, and reading files back.
export { savePrivateFile, openPrivateFile, deletePrivateFile, readUpload } from './private';
import * as repo from './repo';

/** The person's uploads (name, size, type, when), oldest first. */
export function uploadsOwnedBy(userId: string) {
  return repo.ownedBy(userId);
}
