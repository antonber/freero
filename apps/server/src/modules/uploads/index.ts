// Public API of modules/uploads [S2].
export { bytesOf as uploadBytesOf } from './repo';
export { saveUpload, deleteUpload, uploadBytesUsed, contentMatches, UPLOAD_REF_PATTERN, uploadNamesIn } from './store';
// Board backups (modules/backup, KAI-137): a carried file re-uploaded for the restorer, checked like any upload.
export { restoreUploadFile } from './store';
// Data exports (modules/privacy): archives kept out of /uploads and the sweep, and reading files back.
export { savePrivateFile, openPrivateFile, deletePrivateFile, readUpload } from './private';
import * as repo from './repo';

/** The person's uploads (name, size, type, when), oldest first. */
export function uploadsOwnedBy(userId: string) {
  return repo.ownedBy(userId);
}
// Operators (modules/moderation): remove a file (410 from then on), restore it, purge its kept copy.
export {
  uploadName,
  uploadForModeration,
  openUploadForModeration,
  isUploadRemoved,
  removeUpload,
  restoreUpload,
  purgeRemovedUpload,
  keepRemovedUploadsOf,
  keptCopiesRemovedBefore,
  type ModerationUploadState,
} from './moderation';
