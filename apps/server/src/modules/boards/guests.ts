// A board's guests as its owner and co-owners manage them (#97, @freero/shared guestEditing.ts):
// who joined or added items, removing everything one added, and removing one. auth keeps who a
// guest is; realtime holds what they added; this decides who may act and records it.
import { isGuestId, type BoardGuest } from '@freero/shared';
import { forbidden, notFound } from '../../platform/http';
import { recordAuditQuietly } from '../audit/index';
import { guestsOfBoard, removeGuest } from '../auth/index';
import { managesSharing } from '../members/index';
import { boardGuestActivity, removeGuestItems } from '../realtime/index';
import { boardTarget, requireAccess } from './service';

async function requireManager(boardId: string, userId: string) {
  const { board, role, coOwner } = await requireAccess(boardId, userId);
  if (!managesSharing(role, coOwner)) throw forbidden('Only the board’s owner and co-owners manage its guests');
  return board;
}

/** The board's guests: live sessions (removed ones too) and anyone whose items are still on it. */
export async function listBoardGuests(boardId: string, userId: string): Promise<BoardGuest[]> {
  const board = await requireManager(boardId, userId);
  const [sessions, activity] = await Promise.all([guestsOfBoard(board.id), boardGuestActivity(board.id)]);
  const byId = new Map(sessions.map((g) => [g.id, g]));
  const ids = new Set([...byId.keys(), ...activity.items.keys()]);
  const out: BoardGuest[] = [...ids].map((id) => {
    const s = byId.get(id);
    const a = activity.items.get(id);
    return {
      id,
      name: s?.name ?? a?.name ?? '',
      color: s?.color ?? null,
      online: activity.online.has(id),
      items: a?.items ?? 0,
      active: !!s && !s.removed,
      removed: s?.removed ?? false,
    };
  });
  return out.sort((x, y) => Number(y.online) - Number(x.online) || y.items - x.items || x.name.localeCompare(y.name));
}

/** Deletes every item the guest added (the shared board and its drafts); audited. Returns how many. */
export async function undoGuestEdits(boardId: string, userId: string, guestId: string): Promise<number> {
  const board = await requireManager(boardId, userId);
  if (!isGuestId(guestId)) throw notFound('No such guest');
  const removed = await removeGuestItems(board.id, guestId);
  await recordAuditQuietly({ action: 'board.guest_edits_undone', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { guestId, items: removed } });
  return removed;
}

/** Removes a guest from the board: its sockets close and that browser can't rejoin until its session expires; audited. */
export async function removeBoardGuest(boardId: string, userId: string, guestId: string): Promise<void> {
  const board = await requireManager(boardId, userId);
  if (!isGuestId(guestId) || !(await removeGuest(board.id, guestId))) throw notFound('No such guest on this board');
  await recordAuditQuietly({ action: 'board.guest_removed', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { guestId } });
}
