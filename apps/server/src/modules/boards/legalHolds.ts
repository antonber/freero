// Legal holds (#157; docs/design/compliance.md §1). Only this module deletes boards, so it keeps the
// holds: modules/ediscovery's cases place, narrow and release them here by an opaque hold id (the
// case id). While any hold names a board (or its owner in its workspace, a custodian), nothing
// deletes it: the trash purge and retention rules skip it, "delete forever" only discards it
// (hidden, kept), the account purge and workspace deletion wait or refuse — and the database
// refuses the delete on any path (migration 202611301005_board_legal_holds.sql).
import * as repo from './repo';

export interface LegalHoldScope {
  boardIds: string[];
  /** Every board each person owns in that workspace, now and later. */
  custodians: Array<{ workspaceId: string; ownerId: string }>;
}

export interface HeldBoard {
  id: string;
  kind: 'board' | 'doc';
  title: string;
  ownerId: string;
  workspaceId: string;
  createdAt: number;
  updatedAt: number;
  state: 'live' | 'archived' | 'trashed' | 'deleted' | 'taken_down';
}

/** Adds to hold `holdId` (in the caller's transaction, if any). */
export function placeLegalHold(holdId: string, scope: LegalHoldScope, now = Date.now()): Promise<void> {
  return repo.placeLegalHold(holdId, scope, now);
}

export function narrowLegalHold(holdId: string, scope: { boardIds: string[]; ownerIds: string[] }): Promise<void> {
  return repo.narrowLegalHold(holdId, scope);
}

/** Ends hold `holdId`; boards no other hold keeps follow their normal retention again (the next trash round purges those deleted meanwhile). */
export function releaseLegalHold(holdId: string): Promise<void> {
  return repo.releaseLegalHold(holdId);
}

export function legalHoldScope(holdId: string): Promise<LegalHoldScope> {
  return repo.legalHoldScope(holdId);
}

/** The boards hold `holdId` keeps right now, whatever state they are in (what a case reviews and exports). */
export async function boardsUnderLegalHold(holdId: string): Promise<HeldBoard[]> {
  return (await repo.boardsUnderLegalHold(holdId)).map((b) => ({
    id: b.id,
    kind: b.kind,
    title: b.title,
    ownerId: b.ownerId,
    workspaceId: b.workspaceId,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    state: b.removedAt !== null ? 'taken_down' : b.discarded ? 'deleted' : b.deletedAt !== null ? 'trashed' : b.archivedAt !== null ? 'archived' : 'live',
  }));
}

/** The ids among `ids` under any legal hold (version and audit retention ask this). */
export function legallyHeldAmong(ids: string[]): Promise<Set<string>> {
  return repo.heldAmong(ids);
}

/** Whether a legal hold touches this person (a custodian, or owner of a held board) or this workspace. */
export async function underLegalHold(by: { ownerId: string } | { workspaceId: string }): Promise<boolean> {
  return (await repo.legalHoldCount(by)) > 0;
}
