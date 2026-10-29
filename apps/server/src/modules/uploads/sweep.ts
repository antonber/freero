// Mark-and-sweep of uploaded files nothing references any more (KAI-74).
//
// Uploads are shared freely: a duplicated board, a saved template, a pasted copy on another board
// and an avatar can all point at the same "/uploads/<name>". So nothing deletes a user's upload
// when one of those goes away (a board purged from the trash, a template or an account deleted);
// this sweep does. Each module that stores content exposes "which uploads do you reference" from
// its index; this module asks them all.
//
// A round (platform/jobs: one instance at a time, idempotent, so an interrupted round is simply
// finished by the next):
//   1. adopt: a stored file without a row in `uploads` gets one (no owner), so thumbnails, files
//      from before the table and rows deleted with an account go through the same rules below;
//   2. mark: every upload referenced anywhere gets last_referenced_at = now;
//   3. candidates: uploads no round has seen referenced for UPLOAD_GRACE_MS (counted from their
//      upload or adoption when never seen, so a file still on its way onto a board is kept);
//   4. re-check: ask every module again for just those, right before deleting, so a reference
//      added since the mark (another instance saving a board, a template just saved) keeps it;
//   5. delete the rows that are STILL idle, then their files (one transaction: if storage fails
//      the rows come back and the next round retries). Freed rows free their owner's quota.
// What remains is a reference that lives only in a client's memory (an undo stack, a clipboard)
// for longer than the grace period.
import { storage } from '../../platform/storage';
import { runExclusive } from '../../platform/jobs';
import { avatarUploadReferences } from '../auth/index';
import { thumbnailUploadReferences } from '../boards/index';
import { boardUploadReferences } from '../realtime/index';
import { templateUploadReferences } from '../templates/index';
import { walkthroughUploadReferences } from '../walkthroughs/index';
import * as repo from './repo';
import { FILE_NAME_RE, TYPE_BY_EXT } from './store';

export const UPLOAD_SWEEP_LOCK_KEY = 7_202_610_283; // arbitrary, constant across releases
/** How long an upload must go unreferenced before it is deleted. */
export const UPLOAD_GRACE_MS = 24 * 60 * 60 * 1000;
const BATCH = 500;
const DELETE_CONCURRENCY = 16;

/** Upload names referenced somewhere, restricted to `among` when given. */
export type ReferenceScan = (among?: readonly string[]) => Promise<Iterable<string>>;

/**
 * Every kind of stored content that can hold an /uploads URL. Content of a new kind that stores
 * upload URLs outside board documents (which are already scanned) adds its module's scan here.
 */
const SCANS: ReferenceScan[] = [boardUploadReferences, templateUploadReferences, avatarUploadReferences, thumbnailUploadReferences, walkthroughUploadReferences];

export async function referencedUploads(among?: readonly string[]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const names of await Promise.all(SCANS.map((scan) => scan(among)))) for (const n of names) found.add(n);
  return found;
}

async function adoptStrayFiles(now: number): Promise<void> {
  let batch: Array<{ name: string; bytes: number; contentType: string }> = [];
  for await (const { key, size } of storage().list()) {
    if (!FILE_NAME_RE.test(key)) continue; // temp files of a write in progress, foreign keys
    batch.push({ name: key, bytes: size, contentType: TYPE_BY_EXT[key.split('.').pop()!] });
    if (batch.length >= BATCH) {
      await repo.adoptFiles(batch, now);
      batch = [];
    }
  }
  await repo.adoptFiles(batch, now);
}

async function removeFiles(names: string[]): Promise<void> {
  for (let i = 0; i < names.length; i += DELETE_CONCURRENCY)
    await Promise.all(names.slice(i, i + DELETE_CONCURRENCY).map((n) => storage().delete(n)));
}

/**
 * One sweep round (see the header); the caller holds UPLOAD_SWEEP_LOCK_KEY. Returns how many
 * uploads it deleted. `references` is the scan to use (tests replace it to act between the mark
 * and the re-check).
 */
export async function sweepUploadsLocked(
  now = Date.now(),
  references: (among?: readonly string[]) => Promise<Set<string>> = referencedUploads,
): Promise<number> {
  const before = now - UPLOAD_GRACE_MS;
  await adoptStrayFiles(now);
  await repo.markReferenced([...(await references())], now);
  let total = 0;
  for (;;) {
    const idle = await repo.idleSince(before, BATCH);
    if (!idle.length) break;
    const again = await references(idle);
    await repo.markReferenced([...again], now); // referenced after all: out of the idle set
    const doomed = idle.filter((n) => !again.has(n));
    const deleted = await repo.transaction(async () => {
      const gone = await repo.deleteIdle(doomed, before);
      await removeFiles(gone);
      return gone;
    });
    total += deleted.length;
    if (idle.length < BATCH) break;
  }
  return total;
}

/** A sweep round, unless another instance is sweeping right now (then null). */
export function sweepUploads(now = Date.now()): Promise<number | null> {
  return runExclusive(UPLOAD_SWEEP_LOCK_KEY, () => sweepUploadsLocked(now));
}
