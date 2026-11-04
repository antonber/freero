// Sealing a board's stored content again (#159): every stored blob (base, log, versions, layers) not
// sealed with the data key its workspace seals with now is opened and written again under it — or in
// the clear, for a board now in a workspace without a key. Used when a workspace turns its key on
// (content stored before), after a data-key rotation (content under older versions), and by a board
// moving to another workspace (before the move, and again after it for saves in between). A row
// replaced meanwhile (a compaction, a save) is left alone: it was written under the current key.
import * as repo from './repo';
import { openStored, sealerFor } from './sealing';

/**
 * Reseals the board for its workspace (or for `workspaceId`, where it is about to move). Throws
 * KeyUnavailableError when a stored blob can't be opened or the target's key can't seal; nothing
 * is changed then. Returns how many rows it rewrote.
 */
export async function resealBoard(boardId: string, workspaceId?: string): Promise<number> {
  const sealer = await sealerFor(boardId, workspaceId);
  const stale = (await repo.storedRowsOf(boardId)).filter((r) => r.sealedWith !== sealer.ref && !repo.isEmptyPlaceholder(r));
  if (!stale.length) return 0;
  const rows = [];
  for (const r of stale) rows.push({ ...r, next: sealer.seal(r.table, await openStored(boardId, r.table, r.data, r.sealedWith, r.layer), r.layer) });
  return repo.replaceStoredRows(boardId, rows, sealer);
}

/** The boards among these whose stored content isn't all sealed with `ref` (null: holds sealed content). */
export function boardsNeedingReseal(boardIds: string[], ref: string | null): Promise<string[]> {
  return repo.boardsNotSealedWith(boardIds, ref);
}
