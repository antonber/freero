// #158: a board's label set by a workspace policy rather than a person — the sensitive-data scan
// (modules/dlp) gives a board the label its workspace requires when it finds something — and the
// say such a policy has over people's label changes (a board holding findings can't be relabelled
// to something less strict). Boards stays the only writer of `boards.label_id`.
import { recordAudit } from '../audit/index';
import { refreshBoardAccess } from '../realtime/index';
import { labelsAvailableIn } from '../workspaces/index';
import * as repo from './repo';

export interface LabelChange {
  boardId: string;
  workspaceId: string;
  fromLabelId: string | null;
  toLabelId: string | null;
}
/** Throws an HttpError to refuse the change; resolves to allow it. */
export type LabelChangeGuard = (change: LabelChange) => Promise<void>;
const guards = new Set<LabelChangeGuard>();

export function onLabelChange(guard: LabelChangeGuard): () => void {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** Every guard's say over a person's label change (setBoardLabel), before it is made. */
export async function checkLabelChange(change: LabelChange): Promise<void> {
  for (const g of guards) await g(change);
}

/**
 * Gives the board `labelId` because its workspace's policy says so (`reason`), with no person
 * acting: audited `board.label_changed` with the reason, everyone connected re-checked. False when
 * the board is gone, already carries it, or the label isn't one its workspace may use.
 */
export async function applyLabelByPolicy(boardId: string, labelId: string, reason: 'sensitive_data'): Promise<boolean> {
  const board = await repo.getBoard(boardId);
  if (!board || board.labelId === labelId) return false;
  const available = await labelsAvailableIn(board.workspaceId);
  const label = available.find((l) => l.id === labelId);
  if (!label) return false;
  const from = board.labelId ? (available.find((l) => l.id === board.labelId)?.name ?? null) : null;
  const changed = await repo.transaction(async () => {
    if (!(await repo.setLabel(board.id, labelId))) return false;
    await recordAudit({
      action: 'board.label_changed',
      workspaceId: board.workspaceId,
      actorId: null,
      target: { type: board.kind === 'doc' ? 'doc' : 'board', id: board.id, label: board.title },
      metadata: { from, fromId: board.labelId, to: label.name, toId: labelId, reason },
    });
    return true;
  });
  if (changed) await refreshBoardAccess(board.id);
  return changed;
}
