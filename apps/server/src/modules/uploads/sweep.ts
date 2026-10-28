// Mark-and-sweep of uploaded files nothing references any more (KAI-74).
//
// Uploads are shared freely: a duplicated board, a saved template, a pasted copy on another board
// and an avatar can all point at the same "/uploads/<name>". So nothing deletes a user's upload
// when one of those goes away (a board purged from the trash, a template or account deleted);
// this sweep does, for every row in `uploads` (files counted toward a quota). Each module that
// stores content exposes "which uploads do you reference" from its index; this module asks them.
//
// A round:
//   1. mark: every upload referenced anywhere gets last_referenced_at = now;
//   2. candidates: uploads no round has seen referenced for UPLOAD_GRACE_MS (counted from their
//      upload for files never seen referenced, so one still on its way onto a board is kept);
//   3. re-check: ask every module again for just those, right before deleting, so a reference
//      added since the mark (another instance saving a board, a template just saved) keeps it;
//   4. delete, under an advisory lock so only one instance deletes at a time, only the rows that
//      are STILL idle (a concurrent round's mark wins), then their files. Freed rows free quota.
// Safe on every instance at once: marking is idempotent, and a file is removed only by the
// transaction that deleted its row. What remains is a reference that exists only in a client's
// memory (an undo stack, a clipboard) for longer than the grace period.
import { storage } from '../../platform/storage';
import { avatarUploadReferences } from '../auth/index';
import { boardUploadReferences } from '../realtime/index';
import { templateUploadReferences } from '../templates/index';
import * as repo from './repo';

/** How long an upload must go unreferenced before it is deleted. */
export const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const DELETE_CONCURRENCY = 16;

/** Upload names referenced somewhere, restricted to `among` when given. */
export type ReferenceScan = (among?: readonly string[]) => Promise<Iterable<string>>;

/**
 * Every kind of stored content that can hold an /uploads URL. Content of a new kind that stores
 * upload URLs (outside board documents, which are already scanned) adds its module's scan here.
 */
const SCANS: ReferenceScan[] = [boardUploadReferences, templateUploadReferences, avatarUploadReferences];

export async function referencedUploads(among?: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const names of await Promise.all(SCANS.map((scan) => scan(among)))) for (const n of names) found.add(n);
  return found;
}

async function removeFiles(names: string[]): Promise<void> {
  for (let i = 0; i < names.length; i += DELETE_CONCURRENCY)
    await Promise.all(names.slice(i, i + DELETE_CONCURRENCY).map((n) => storage().delete(n)));
}

/**
 * One sweep round (see the header). Returns how many uploads this call deleted. `references` is
 * the scan to use (tests replace it to act between the mark and the re-check).
 */
export async function sweepUploads(
  now = Date.now(),
  references: (among?: readonly string[]) => Promise<Set<string>> = referencedUploads,
): Promise<number> {
  const before = now - UPLOAD_GRACE_MS;
  await repo.markReferenced([...(await references())], now);
  let total = 0;
  for (;;) {
    const idle = await repo.idleSince(before, BATCH);
    if (!idle.length) break;
    const again = await references(idle);
    await repo.markReferenced([...again], now); // referenced after all: out of the idle set
    const doomed = idle.filter((n) => !again.has(n));
    const deleted = await repo.transaction(async () => {
      if (!(await repo.tryLockSweep())) return null;
      const gone = await repo.deleteIdle(doomed, before);
      // Inside the transaction: if storage fails, the rows come back and the next round retries
      // (deleting a file that is already gone is not an error).
      await removeFiles(gone);
      return gone;
    });
    if (deleted === null) break; // another instance is deleting right now; the next round continues
    total += deleted.length;
    if (idle.length < BATCH) break;
  }
  return total;
}
