// The app's side of offline copies (#178): which boards are kept, when they are dropped, and what
// the board page opens without a network. The vault (vault.ts) stores; this decides.
//
// - A board is kept only when the server says so for this person (`BoardPermissions.offline`: the
//   workspace's `offlineCopies` policy, and never a board under a workspace key unless the policy
//   allows it). Absent (an older server) or false: nothing is kept, and an existing copy goes.
// - Signing out, a session found gone, or someone else signing in on this device: everything goes.
// - Each time the app starts online, the server is asked which kept boards this person may still
//   keep (`POST /api/boards/offline-check`); the rest go. A board whose socket the server ends for
//   good (access removed) goes at once (the engine's `forget`).
import type { Account, BoardSummary } from '@freero/shared';
import type { HostOffline } from '@engine';
import { indexedDbBackend, OfflineVault, type OfflineBoardInfo } from './vault';

/** How the app asks the server which boards may stay (api.offlineCheck in the app). */
export type OfflineCheck = (ids: string[]) => Promise<{ keep: string[] }>;

let vault: OfflineVault | null | undefined;
/** Bumped by every wipe: a board still open from before (closing after sign-out) can't write again. */
let generation = 0;

function theVault(): OfflineVault | null {
  if (vault === undefined) {
    const backend = indexedDbBackend();
    vault = backend ? new OfflineVault(backend) : null;
  }
  return vault;
}

/** Tests: a vault over a memory backend (null: as without IndexedDB). */
export function setVaultForTests(v: OfflineVault | null): void {
  vault = v;
  generation++;
}

/** Signed out, or the session is gone: nothing of this person stays on the device. */
export async function offlineSignedOut(): Promise<void> {
  generation++;
  await theVault()?.wipe().catch(() => undefined);
}

/**
 * The session check found `user` signed in (online): another person's vault goes; this person's
 * account card is refreshed and the boards they may no longer keep go.
 */
export async function offlineSignedIn(user: Account, check: OfflineCheck): Promise<void> {
  const v = theVault();
  if (!v) return;
  try {
    const owner = await v.owner();
    if (owner === null) return;
    if (owner !== user.id) {
      generation++;
      return void (await v.wipe());
    }
    await v.rememberAccount(user);
    const ids = await v.boardIds();
    if (!ids.length) return;
    const { keep } = await check(ids);
    const stays = new Set(keep);
    for (const id of ids) if (!stays.has(id)) await v.forgetBoard(id);
  } catch {
    // offline or the server can't answer: checked again next time the app starts
  }
}

/** The account kept with the boards, for starting the app without a network (null: none). */
export async function offlineAccount(): Promise<Account | null> {
  return (await theVault()?.account().catch(() => null)) ?? null;
}

/** A board kept for `userId`, to open it without the server (null: none). */
export async function offlineBoard(userId: string, boardId: string): Promise<OfflineBoardInfo | null> {
  return (await theVault()?.loadBoard(userId, boardId).catch(() => null))?.info ?? null;
}

/** Drops one board's copy (the server said it's gone, or no longer allowed). */
export async function forgetOfflineBoard(boardId: string): Promise<void> {
  await theVault()?.forgetBoard(boardId).catch(() => undefined);
}

/**
 * Host.offline for a board the person opens: undefined (and any copy dropped) unless the server lets
 * them keep it. `info` is read on every save, so a rename is kept too.
 */
export function offlineHostFor(user: Account, info: OfflineBoardInfo): HostOffline | undefined {
  const v = theVault();
  if (!v) return undefined;
  if (!mayKeep(info.board)) {
    void v.forgetBoard(info.board.id).catch(() => undefined);
    return undefined;
  }
  const born = generation;
  const id = info.board.id;
  return {
    load: async () => (born === generation ? ((await v.loadBoard(user.id, id))?.copy ?? null) : null),
    save: async (copy) => {
      if (born === generation) await v.saveBoard(user, info, copy);
    },
    forget: () => v.forgetBoard(id),
  };
}

/** The server's word for this person and board; guests and older servers keep nothing. */
export const mayKeep = (board: BoardSummary): boolean => board.permissions.offline === true && board.kind !== 'doc';
