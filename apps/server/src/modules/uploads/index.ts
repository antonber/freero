// Public API of modules/uploads [S2].
export { bytesOf as uploadBytesOf } from './repo';
export { saveUpload, deleteUpload, uploadBytesUsed, contentMatches, UPLOAD_REF_PATTERN, uploadNamesIn } from './store';
// Operators (modules/moderation): remove a file (410 from then on), restore it, purge its kept copy.
export {
  uploadName,
  uploadForModeration,
  isUploadRemoved,
  removeUpload,
  restoreUpload,
  purgeRemovedUpload,
  keepRemovedUploadsOf,
  keptCopiesRemovedBefore,
  type ModerationUploadState,
} from './moderation';
