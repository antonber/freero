// When people stop looking at a board: the trusted source of "changes since your last visit"
// (modules/activity keeps the marker). Reported when one of THIS instance's board sockets of an
// account closes (a tab closed or navigated away, a reload, a dropped connection), never on a
// client's word. While any tab of theirs is open they see changes live, so the moment a socket
// closes is when "since you were here" starts; a reconnect after a drop just moves it on.
// Guests have no account to keep it for; docs (KAI-162) have no catch-up.
import { isGuestId } from '@freero/shared';
import { logError } from '../../platform/log';

export interface BoardLeftEvent {
  boardId: string;
  userId: string;
  at: number;
}

type Listener = (e: BoardLeftEvent) => void;
const listeners = new Set<Listener>();

/** Called synchronously when an account's board socket on this instance closes. Keep it cheap. */
export function onBoardLeft(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitBoardLeft(e: BoardLeftEvent): void {
  if (isGuestId(e.userId)) return;
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      logError('realtime: a board-left listener failed', err);
    }
  }
}
