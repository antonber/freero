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

export interface AccessRequestedEvent {
  boardId: string;
  boardTitle: string;
  requesterId: string;
  role: Exclude<Role, 'owner'>;
  message: string;
  createdAt: number;
  /** Who should hear about it (the board owner, and the admins or the project's lead). */
  recipientIds: string[];
}

export interface AccessDecidedEvent {
  boardId: string;
  boardTitle: string;
  requesterId: string;
  deciderId: string;
  approved: boolean;
  /** The role granted (approved), else null. */
  role: Exclude<Role, 'owner'> | null;
}

type RequestedListener = (e: AccessRequestedEvent) => Promise<void> | void;
type DecidedListener = (e: AccessDecidedEvent) => Promise<void> | void;
const requestedListeners = new Set<RequestedListener>();
const decidedListeners = new Set<DecidedListener>();

/** Someone asked for access to a board (a new pending request). */
export function onAccessRequested(fn: RequestedListener): () => void {
  requestedListeners.add(fn);
  return () => requestedListeners.delete(fn);
}

/** A pending access request was approved or declined. */
export function onAccessDecided(fn: DecidedListener): () => void {
  decidedListeners.add(fn);
  return () => decidedListeners.delete(fn);
}

export async function accessRequested(e: AccessRequestedEvent): Promise<void> {
  for (const fn of requestedListeners) {
    try {
      await fn(e);
    } catch (err) {
      logError('members: an access-requested listener failed', err);
    }
  }
}

export async function accessDecided(e: AccessDecidedEvent): Promise<void> {
  for (const fn of decidedListeners) {
    try {
      await fn(e);
    } catch (err) {
      logError('members: an access-decided listener failed', err);
    }
  }
}
