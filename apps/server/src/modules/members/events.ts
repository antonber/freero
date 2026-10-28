// In-process events of modules/members, for modules that react to sharing (notifications).
import type { Role } from '@freero/shared';
import { logError } from '../../platform/log';

export interface BoardSharedEvent {
  boardId: string;
  boardTitle: string;
  /** The existing account the board was shared with (added, or given another role). */
  userId: string;
  role: Exclude<Role, 'owner'>;
  /** Who shared it. */
  byId: string;
}

type Listener = (e: BoardSharedEvent) => Promise<void> | void;
const listeners = new Set<Listener>();

/** Someone shared a board with an existing account from the share dialog. */
export function onBoardShared(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function boardShared(e: BoardSharedEvent): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(e);
    } catch (err) {
      logError('members: a board-shared listener failed', err);
    }
  }
}

export interface InviteAcceptedEvent {
  boardId: string;
  /** The account that now has access through the invite. */
  userId: string;
  /** The address the invite was sent to. */
  email: string;
}

type AcceptedListener = (e: InviteAcceptedEvent) => Promise<void> | void;
const acceptedListeners = new Set<AcceptedListener>();

/** A pending invite (sent to an address) became access for an account: its link, or a verified address. */
export function onInviteAccepted(fn: AcceptedListener): () => void {
  acceptedListeners.add(fn);
  return () => acceptedListeners.delete(fn);
}

export async function inviteAccepted(e: InviteAcceptedEvent): Promise<void> {
  for (const fn of acceptedListeners) {
    try {
      await fn(e);
    } catch (err) {
      logError('members: an invite-accepted listener failed', err);
    }
  }
}
