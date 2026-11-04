// Guest editing (#97): visitors without an account on a board's "can edit" link may add and change
// simple content, when the board's owner (or a co-owner) turns it on and nothing above forbids it.
// Off by default at every level that matters: the board's switch (`BoardSharingSettings.guestsCanEdit`)
// starts off; the workspace's policy `guestEditing` (an organisation's floor too) and the operator
// (GUEST_EDITING=off) can forbid it. With any of them off, a guest is a commenter exactly as before.
//
// A guest editor is still a COMMENTER everywhere (REST, layers, comments, facilitation): the server
// adds one thing on its board socket (apps/server/src/modules/realtime/guestEditing.ts), checked
// inside the transaction that applies each update, like the facilitation guards:
//
//   add        elements of GUEST_EDIT_TYPES only (no frames, images, files or embeds: nothing that
//              uploads or frames outside content), within GUEST_EDIT_LIMITS
//   change     only elements it created itself (`createdBy`, stamped by the server), never locked
//              ones, never into another type, never to lock, protect or link them
//   delete     only elements it created itself that aren't locked
//
// Everything else it sends is undone (and it is sent the correction). Every element a guest adds
// carries `guestName` (stamped by the server, never by a client), so it is labelled "Guest · <name>"
// on the board, in exports and in versions, after the guest's session is long gone. The owner and
// co-owners see the board's guests in the share dialog, can remove everything one added in one step
// and remove the guest (their session ends and can't rejoin the board).
import type { ElementType } from './elements';

/** What a guest editor may add (the client offers only the tools that add these). */
export const GUEST_EDIT_TYPES: readonly ElementType[] = ['sticky', 'shape', 'text', 'connector', 'pen', 'emoji'];

/**
 * The server's limits for guest editors (per board). Items are counted when they are ADDED; going over a
 * limit undoes the add and tells the guest why (GuestEditNotice). `updatesPerSecond` / `updateBurst`:
 * a token bucket per socket — past it, changes are undone until it refills. An update larger than
 * `maxUpdateBytes` closes the socket.
 */
export const GUEST_EDIT_LIMITS = {
  itemsPerHour: 100,
  itemsPerGuest: 300,
  guestItemsPerBoard: 1500,
  updatesPerSecond: 60,
  updateBurst: 600,
  maxUpdateBytes: 256 * 1024,
} as const;

/** [additive, #97] `RoleMessage.guestEdit`: this guest may add and change its own content of these types. */
export interface GuestEditGrant {
  types: ElementType[];
}

/** Why the server undid a guest's change (sent once in a while, never for every update). */
export type GuestEditNoticeCode = 'hourly' | 'total' | 'board' | 'rate';
/**
 * Server -> client: writeVarUint(WS_MESSAGE_NOTICE), writeVarString(JSON.stringify(GuestEditNotice)).
 * Clients that don't know the message type ignore it.
 */
export const WS_MESSAGE_NOTICE = 103;
export interface GuestEditNotice {
  type: 'guest-edit';
  code: GuestEditNoticeCode;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** May guest `guestId` change or delete element `el` (its own, unlocked, of a type guests may edit)? */
export function guestMayChange(el: unknown, guestId: string): boolean {
  return (
    isObj(el) &&
    el.createdBy === guestId &&
    !el.locked &&
    !el.lockProtected &&
    typeof el.type === 'string' &&
    (GUEST_EDIT_TYPES as readonly string[]).includes(el.type)
  );
}

/** A guest of a board as its owner sees it in the share dialog (GET /boards/:id/guests). */
export interface BoardGuest {
  id: string;
  /** As typed; shown as guestDisplayName(name). */
  name: string;
  color: string | null;
  /** Has a socket on the board right now. */
  online: boolean;
  /** Items on the board it added (the shared board; its private drafts are its own). */
  items: number;
  /** Its session is still live (not expired, not removed). */
  active: boolean;
  /** The owner removed it from the board. */
  removed: boolean;
}
// GET    /api/boards/:id/guests                 -> { guests: BoardGuest[] }  (owners and co-owners)
// POST   /api/boards/:id/guests/:guestId/undo   -> { removed: number }  (deletes every item the guest added)
// DELETE /api/boards/:id/guests/:guestId        -> { ok: true }  (ends its session for good; its sockets close)
export interface BoardGuestsResponse {
  guests: BoardGuest[];
}
/** `code` of a 403: this browser's guest was removed from the board by its owner. */
export const GUEST_REMOVED = 'guest_removed';
