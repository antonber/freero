// Public API of modules/uploads [S2].
export { bytesOf as uploadBytesOf } from './repo';
export { saveUpload, deleteUpload, uploadBytesUsed, contentMatches, UPLOAD_REF_PATTERN, uploadNamesIn } from './store';
// Data exports (modules/privacy): archives kept out of /uploads and the sweep, and reading files back.
export { savePrivateFile, openPrivateFile, deletePrivateFile, readUpload } from './private';
import * as repo from './repo';

/**
 * What an upload is (by name): who stored it, its type as its bytes said, whether an operator
 * removed it. Null for a name nobody uploaded. For modules that adopt an upload someone made
 * (walkthroughs check the recording is the caller's own video / audio).
 */
export async function uploadInfo(name: string): Promise<{ ownerId: string | null; contentType: string; bytes: number; removed: boolean } | null> {
  const row = await repo.getUploadRow(name);
  return row ? { ownerId: row.ownerId, contentType: row.contentType, bytes: row.bytes, removed: row.removedAt !== null } : null;
}

/**
 * An upload's bytes as a stream, for a module serving it as a DOWNLOAD under its own rules (the
 * caller checked access and the downloads policy and audits it). 410 once an operator removed it.
 */
export { openUploadForDownload } from './download';
/** "Q3 plan.xlsx" as a Content-Disposition attachment (RFC 6266 + 5987), for those downloads. */
export { attachmentDisposition } from './routes';

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
