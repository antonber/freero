// Which uploads board documents reference, for the uploads sweep (modules/uploads/sweep.ts).
import { UPLOAD_REF_PATTERN, uploadNamesIn } from '../uploads/index';
import * as repo from './repo';
import { loadedDocStates } from './rooms';

/**
 * Upload names referenced by any board's document: stored state (bases, update log, version
 * history; trashed boards included, so restoring one never shows broken images) plus the live
 * docs loaded on this instance. Restricted to `among` when given.
 */
export async function boardUploadReferences(among?: readonly string[]): Promise<string[]> {
  const found = new Set(await repo.matchesInStoredDocs(UPLOAD_REF_PATTERN, among ?? null));
  const wanted = among ? new Set(among) : undefined;
  // latin1 maps every byte to one char, so the ASCII URL inside the binary update reads as is.
  for (const state of loadedDocStates()) for (const n of uploadNamesIn(Buffer.from(state).toString('latin1'), wanted)) found.add(n);
  return [...found];
}
