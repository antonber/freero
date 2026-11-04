// Files under a workspace's key, kept that way (#159; docs/design/compliance.md §3):
// - a board moving to another workspace hands it the files that are only that board's in the source
//   workspace (a file other boards there still show stays the source's: moving one board must not
//   put another board's picture under a key the source doesn't control), and they are sealed again
//   for the target's key (or opened, for a target without one);
// - the `uploads:seal` job seals files again whose workspace seals differently now: a key turned on
//   after they were uploaded, a newer data key after a rotation, a file handed over by a move whose
//   resealing didn't finish. Files of a workspace whose key can't be used wait.
// A file is rewritten whole (put), then its row says so (compare-and-swap); a reader in between
// still opens it, as the stored header names the data key it was sealed with.
import { logError } from '../../platform/log';
import { storage } from '../../platform/storage';
import type { BoardMovedWorkspaceEvent } from '../boards/index';
import { boardIdsInWorkspace, onBoardMovedWorkspace } from '../boards/index';
import { currentSealRef, hasKey, keyedWorkspaces, KeyUnavailableError, keysInUse, sealerFor } from '../keys/index';
import { storedBoardContent } from '../realtime/index';
import * as repo from './repo';
import { readStoredPlain, sealFile } from './sealedFiles';
import { SEALED_CACHE_CONTROL, uploadCacheControl } from './store';

/**
 * Seals one file for the workspace now governing it (or stores it as uploaded, for a workspace
 * without a key). 'waiting' when that workspace's key can't seal now, or the file's own key can't
 * open it; 'changed' when someone else resealed it meanwhile.
 */
export async function resealFile(name: string): Promise<'done' | 'unchanged' | 'waiting' | 'changed' | 'gone'> {
  const row = await repo.getUploadRow(name);
  if (!row || !row.workspaceId || row.removedAt !== null) return 'gone';
  const ws = row.workspaceId;
  const target = await currentSealRef(ws);
  if (!target && (await hasKey(ws))) return 'waiting';
  if (row.sealedWith === target) return 'unchanged';
  let plain: Buffer | null;
  try {
    plain = await readStoredPlain(name, row);
  } catch (e) {
    if (e instanceof KeyUnavailableError) return 'waiting';
    throw e;
  }
  if (!plain) return 'gone';
  let sealer;
  try {
    sealer = target ? await sealerFor(ws) : null;
  } catch (e) {
    if (e instanceof KeyUnavailableError) return 'waiting';
    throw e;
  }
  const bytes = sealer ? sealFile(name, plain, sealer) : plain;
  await storage().put(name, bytes, row.contentType, { cacheControl: sealer ? SEALED_CACHE_CONTROL : uploadCacheControl() });
  return (await repo.setSealing(name, row.sealedWith, sealer?.ref ?? null, ws)) ? 'done' : 'changed';
}

/** The `uploads:seal` job: up to `max` files sealed again. Returns how many it rewrote. */
export async function sealPendingFiles(max = 50): Promise<number> {
  if (!(await keysInUse())) return 0;
  const { sealing, unusable } = await keyedWorkspaces();
  let done = 0;
  for (const f of await repo.filesToReseal(sealing, unusable, max)) {
    try {
      if ((await resealFile(f.name)) === 'done') done++;
    } catch (e) {
      logError(`uploads: sealing file ${f.name} again failed this round`, e);
    }
  }
  return done;
}

/** Moved boards take their own files with them (see the header), from now on; returns how to stop. */
export function followBoardMoves(): () => void {
  const stop = onBoardMovedWorkspace(boardFilesMoved);
  return () => void stop();
}

async function boardFilesMoved(e: BoardMovedWorkspaceEvent): Promise<void> {
  const mine = (await storedBoardContent([e.boardId])).uploadNames;
  const candidates = await repo.filesOfWorkspaceAmong(mine, e.fromWorkspaceId);
  if (!candidates.length) return;
  const others = new Set((await storedBoardContent((await boardIdsInWorkspace(e.fromWorkspaceId)).filter((id) => id !== e.boardId))).uploadNames);
  const handed = await repo.handFilesTo(
    candidates.filter((n) => !others.has(n)),
    e.fromWorkspaceId,
    e.toWorkspaceId,
  );
  // Sealed for the target now; what fails here (its key unreachable a moment) the job finishes.
  for (const name of handed) await resealFile(name).catch((err) => logError(`uploads: sealing file ${name} for its board's new workspace failed; the uploads:seal job retries`, err));
}
