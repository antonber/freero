// Public API of modules/boards [S2].
import type { BoardSummary, ObjectKind, Role } from '@freero/shared';
import { notFound } from '../../platform/http';
import { closeBoardDoc } from '../realtime/index';
import { deleteUpload, UPLOAD_REF_PATTERN } from '../uploads/index';
import { managesSharing, membershipsOf } from '../members/index';
import { boardAccessLoader, getWorkspaceInfo, mayDownload, mayShareExternally, openToWholeTeam, teamMembers, workspaceRole, workspaceRolesOf } from '../workspaces/index';
import * as repo from './repo';
import {
  boardLetsCopy,
  cleanDescription,
  linkProblems,
  cleanTitle,
  createBoard,
  checkEmbeddingChange,
  describeAccess,
  embeddingChanged,
  embeddingOf,
  guestRoleFor,
  listBoards,
  moveToTrash,
  removedFor,
  requireAccess,
  requireDownload,
  summarize,
  toSummary,
  type DownloadVia,
} from './service';

export { createBoard, deleteBoardRowsInWorkspace, cleanUpDeletedBoards } from './service';
// The object registry (modules/objects): boards and items, checked like the board page checks them.
export { registerBoardObjectTypes, boardRoles, elementTitle } from './objects';
// Created, duplicated, renamed, moved, trashed, restored (the activity feed, KAI-188).
export { onBoardLifecycle, type BoardLifecycleEvent, type BoardLifecycleAction } from './events';
// A board moved into another workspace (#124): modules adjust what they keep per workspace.
export { onBoardMovedWorkspace, type BoardMovedWorkspaceEvent } from './events';
// The same, reliably: appended to the outbox in the change's transaction (modules/events, search; KAI-150).
export { BOARD_EVENTS_TOPIC, type BoardEventRecord } from './repo';
// Files downloaded from a board (modules/uploads): the downloads policy, then the audit log.
export { authorizeFileDownload } from './service';
// Board backups (modules/backup, KAI-137): downloading one (downloads policy, audited) and a new
// board restored from one (board row + content in one transaction, audited).
export { authorizeBackup, restoreBoard } from './service';
// An export made outside the browser (the public API / MCP export_board): refused like one by the
// downloads policy, recorded as board.exported.
export { recordExport as recordBoardExport } from './service';
// An app's "Share with team" (MCP Apps, KAI-171): the share dialog's link rules, same audit.
export { shareByLink as shareBoardByLink } from './service';
// Operators (modules/moderation): take down / restore, block / unblock the link, and who may report.
export {
  boardForModeration,
  reportableBoard,
  takeDownBoard,
  restoreTakenDownBoard,
  deleteTakenDownBoard,
  countHeldBoards,
  liveBoardsOwnedBy,
  blockBoardLink,
  unblockBoardLink,
  type ModerationBoardState,
} from './moderation';

/**
 * The user's effective role on a board (`exists: false` when there is no such board, also while
 * it is trashed or taken down; `removed`: it was taken down and this user could open it otherwise).
 */
export async function getBoardAccess(
  boardId: string,
  userId: string,
): Promise<{ exists: boolean; role: Role | null; ownerId: string | null; removed: boolean; kind: ObjectKind | null; coOwner: boolean }> {
  const board = await repo.getBoard(boardId);
  if (!board) return { exists: false, role: null, ownerId: null, removed: await removedFor(boardId, userId), kind: null, coOwner: false };
  const { role, coOwner } = await describeAccess(board, userId);
  return { exists: true, role, ownerId: board.ownerId, removed: false, kind: board.kind, coOwner };
}

/**
 * What each of these containers is (KAI-162): 'board' or 'doc', whatever their state (trashed,
 * taken down). Missing ids are absent. Derived indexes and lists use it to address each one right.
 */
export function objectKindsOf(ids: string[]): Promise<Map<string, ObjectKind>> {
  return repo.kindsOf([...new Set(ids)]);
}

/**
 * What a board shows to ANYONE who has its link and no account (a chat app's link preview, #88):
 * its title, description and thumbnail — only when its link lets a visitor without an account
 * view it (guests allowed by its workspace, no password, not expired, not blocked by an operator,
 * not trashed or taken down). Null for everything else, the same for "no such board" and "not
 * public", so a preview never tells whether a private board exists.
 */
export async function publicLinkPreview(boardId: string): Promise<{ title: string; description: string; thumbnail: string | null } | null> {
  const board = await repo.getBoard(boardId);
  if (!board || board.kind !== 'board' || board.linkPasswordHash !== null) return null;
  if (!(await guestRoleFor(board))) return null;
  return { title: board.title, description: board.description, thumbnail: board.thumbnail };
}

/**
 * Live embeds on other sites (#2, modules/embed): whether other sites may frame the board now —
 * its owner allows it and its workspace's `boardEmbeds` policy is on — and what a visitor without
 * an account may do there ('viewer' exactly when its link lets such visitors in, no password; null:
 * sign in). Null for no such board, a doc, or embedding off: the same answer, so it tells nobody
 * which. Who may do what once signed in is still `getBoardAccess`.
 */
export async function boardEmbedding(
  boardId: string,
): Promise<{ id: string; title: string; description: string; thumbnail: string | null; visitor: 'viewer' | null } | null> {
  const e = await embeddingOf(boardId);
  if (!e) return null;
  const { board, visitor } = e;
  return { id: board.id, title: board.title, description: board.description, thumbnail: board.thumbnail, visitor };
}

/**
 * Turns embedding on other sites on or off as `userId`, by the share dialog's rules (the owner or a
 * co-owner; turning it on also needs the workspace's policy): audited, and open embeds re-checked.
 */
export async function setBoardEmbeddable(boardId: string, userId: string, embeddable: boolean): Promise<void> {
  const { board, role, access, coOwner } = await requireAccess(boardId, userId);
  checkEmbeddingChange(board, managesSharing(role, coOwner), access, embeddable);
  if (board.embeddable === embeddable) return;
  await repo.updateBoardFields(board.id, { embeddable }, Date.now());
  await embeddingChanged(board, userId, embeddable);
}

/**
 * Throws a 404/403 HttpError unless the user has at least `min` on the board. `manages` (#122): its
 * owner or a co-owner, who manage its sharing; `editorsCanShare` (#123): the board lets its editors
 * invite people.
 */
export async function requireBoardAccess(
  boardId: string,
  userId: string,
  min: Role = 'viewer',
): Promise<{
  role: Role;
  kind: ObjectKind;
  ownerId: string;
  title: string;
  workspaceId: string;
  canShareExternally: boolean;
  inWorkspace: (userId: string) => Promise<boolean>;
  coOwner: boolean;
  manages: boolean;
  editorsCanShare: boolean;
}> {
  const { board, role, access, coOwner } = await requireAccess(boardId, userId, min);
  return {
    role,
    kind: board.kind,
    ownerId: board.ownerId,
    title: board.title,
    workspaceId: board.workspaceId,
    canShareExternally: mayShareExternally(access.workspaceRole, access.policies),
    inWorkspace: async (other) => (await workspaceRole(board.workspaceId, other)) !== null,
    coOwner,
    manages: managesSharing(role, coOwner),
    editorsCanShare: board.editorsCanShare,
  };
}

/**
 * The boards of a team workspace whose link is on but doesn't meet its link policy (#39): what the
 * admin console lists (links that predate the policy keep working until someone changes them).
 */
export async function linksOutOfPolicy(
  workspaceId: string,
): Promise<Array<{ id: string; title: string; ownerId: string; linkAccess: string; expiresAt: number | null; problems: Array<'no_password' | 'no_expiry' | 'expiry_too_late'> }>> {
  const boards = await repo.linkedBoardsIn(workspaceId);
  if (!boards.length) return [];
  const policies = (await boardAccessLoader('', [workspaceId]))(boards[0]).policies;
  return boards
    .map((b) => ({ b, problems: linkProblems(b, policies) }))
    .filter((x) => x.problems.length > 0)
    .map(({ b, problems }) => ({ id: b.id, title: b.title, ownerId: b.ownerId, linkAccess: b.storedLinkAccess, expiresAt: b.linkExpiresAt, problems }));
}

/** People with access to the board through its team workspace (none for a personal workspace's board). */
export async function teamAccessUserIds(boardId: string): Promise<string[]> {
  return (await teamAccessMembers(boardId)).map((m) => m.userId);
}

/** The same, with the role the team gives each of them on this board. */
export async function teamAccessMembers(boardId: string): Promise<Array<{ userId: string; role: Role }>> {
  const board = await repo.getBoard(boardId);
  return board ? teamMembers(board) : [];
}

/**
 * 403 `downloads_restricted` (audited) unless the user may take the board's content out — its
 * workspace's "downloads" policy and the board's own "Viewers and commenters can copy and export"
 * (#123). `via` says how (template, outline, api …).
 */
export async function requireBoardDownload(boardId: string, userId: string, via: DownloadVia): Promise<void> {
  const { board, role, access } = await requireAccess(boardId, userId);
  await requireDownload(board, userId, access, via, role);
}

/**
 * The boards of a workspace the user can open, with their role (in their personal workspace also
 * boards shared with them from outside, like the dashboard's "all"). 404 unless they are in it.
 */
export async function boardsOpenableIn(userId: string, workspaceId: string): Promise<Array<{ id: string; title: string; role: Role }>> {
  return (await listBoards(userId, 'all', '', { workspaceId })).map((b) => ({ id: b.id, title: b.title, role: b.role }));
}

/**
 * Boards (not docs) the user owns or starred and can open now, with their title and role: the
 * "changes on your boards" email (modules/notifications). Trashed and taken-down ones are left out.
 */
export async function boardsOwnedOrStarredBy(userId: string): Promise<Array<{ id: string; title: string; role: Role }>> {
  const ids = new Set([...(await repo.boardIdsOwnedBy(userId)), ...(await repo.starredBoardIds(userId))]);
  const out: Array<{ id: string; title: string; role: Role }> = [];
  for (const board of await repo.getBoards([...ids])) {
    if (board.kind !== 'board') continue;
    const { role } = await describeAccess(board, userId);
    if (role) out.push({ id: board.id, title: board.title, role });
  }
  return out;
}

/** Where a (live) board is and who owns it, or null if there is no such board. */
export async function boardPlace(
  boardId: string,
): Promise<{ id: string; kind: ObjectKind; title: string; ownerId: string; workspaceId: string; projectId: string | null } | null> {
  const b = await repo.getBoard(boardId);
  return b ? { id: b.id, kind: b.kind, title: b.title, ownerId: b.ownerId, workspaceId: b.workspaceId, projectId: b.projectId } : null;
}

/** The workspace a board (trashed or not) belongs to, or null if there is no such board. */
export async function boardWorkspaceId(boardId: string): Promise<string | null> {
  return (await repo.getBoardIncludingTrash(boardId))?.workspaceId ?? null;
}

/** The board's title, or null if there is no such board (invite previews). */
export async function getBoardTitle(boardId: string): Promise<string | null> {
  return (await repo.getBoard(boardId))?.title ?? null;
}

/**
 * Account purge: deletes every board the user still owns, like DELETE /boards/:id does (everyone
 * is disconnected first, then the row — members, stars, opens and doc cascade — then the
 * thumbnail). Boards in team workspaces were handed over before (workspaces.handOverTeamWorkspaces).
 * Taken-down boards are held for review and never deleted here (the purge waits for them, KAI-178).
 */
export async function deleteBoardsOwnedBy(userId: string): Promise<number> {
  for (const id of await repo.allBoardIdsOwnedBy(userId)) await closeBoardDoc(id);
  const thumbnails = await repo.deleteAllOwnedBy(userId); // trashed ones too
  for (const t of thumbnails) await deleteUpload(t);
  return thumbnails.length;
}

/** Records that the user opened the board (recent lists; a link-only board becomes discoverable to them). */
export async function recordBoardOpen(boardId: string, userId: string, at = Date.now()): Promise<void> {
  await repo.recordOpen(boardId, userId, at);
}

/** The account purge: which protected board links the account unlocked (KAI-145) is forgotten. */
export function forgetLinkUnlocksOf(userId: string): Promise<void> {
  return repo.forgetUnlocksOf(userId);
}

/** Boards the user ever opened (they may have commented there). */
export async function boardIdsOpenedBy(userId: string): Promise<string[]> {
  return [...(await repo.opensOf(userId)).keys()];
}

/** Records that the board's content changed (called by realtime, throttled). */
export async function touchBoard(boardId: string, at = Date.now()): Promise<void> {
  await repo.touch(boardId, at);
}

/**
 * Candidates for what a person may FIND (search): live boards of the workspaces they are in,
 * boards they are a member of and boards they opened — only those of `workspaceId` when given (a
 * personal workspace also holds what reaches its owner from outside, like the dashboard's home).
 * A superset of what they may see: callers check each candidate with the object registry
 * (modules/objects, purpose 'discover') before showing anything from it.
 */
export async function boardIdsReachableBy(userId: string, workspaceId?: string): Promise<string[]> {
  const [mine, memberships, opens] = await Promise.all([workspaceRolesOf(userId), membershipsOf(userId), repo.opensOf(userId)]);
  const direct = [...new Set([...memberships.keys(), ...opens.keys()])];
  if (!workspaceId) return (await repo.liveIdsAmong([...mine.keys()], direct, null)).map((b) => b.id);
  if (!mine.has(workspaceId)) return [];
  const personal = (await getWorkspaceInfo(workspaceId))?.kind === 'personal';
  if (!personal) return (await repo.liveIdsAmong([workspaceId], direct, workspaceId)).map((b) => b.id);
  return (await repo.liveIdsAmong([workspaceId], direct, null)).filter((b) => b.workspaceId === workspaceId || !mine.has(b.workspaceId)).map((b) => b.id);
}

/**
 * Where each of these live boards is, and whether its workspace's "downloads" policy — and the
 * board's own "Viewers and commenters can copy and export" (#123) — lets the person take content
 * out (KAI-197): a batched, silent `requireBoardDownload` for reads that list many boards at once
 * (search and resolve through the public API and MCP leave the content of the others out instead
 * of refusing the whole call). Boards that are gone are absent.
 */
export async function boardReadPolicies(userId: string, boardIds: string[]): Promise<Map<string, { workspaceId: string; mayDownload: boolean }>> {
  const boards = await repo.getBoards([...new Set(boardIds)]);
  const accessOf = await boardAccessLoader(userId, [...new Set(boards.map((b) => b.workspaceId))]);
  const out = new Map<string, { workspaceId: string; mayDownload: boolean }>();
  for (const b of boards) {
    const allowed = mayDownload(accessOf(b).workspaceRole, accessOf(b).policies);
    // Only a board that keeps its content from viewers and commenters needs the person's role.
    const copies = allowed && (b.viewersCanExport || boardLetsCopy(b, (await describeAccess(b, userId)).role));
    out.set(b.id, { workspaceId: b.workspaceId, mayDownload: copies });
  }
  return out;
}

/**
 * Of these boards (trash included), the ones every full member of their team workspace can open
 * through team access alone — what a workspace-wide integration (webhooks) may be told about —
 * with where they are and their title now. Personal boards, boards in private projects and boards
 * taken down by an operator are absent.
 */
export async function boardsOpenToTheirTeam(boardIds: string[]): Promise<Map<string, { workspaceId: string; title: string }>> {
  const boards = (await repo.getBoardsIncludingTrash([...new Set(boardIds)])).filter((b) => b.removedAt === null);
  const open = await openToWholeTeam(boards.map((b) => ({ workspaceId: b.workspaceId, projectId: b.projectId })));
  return new Map(boards.filter((_, i) => open[i]).map((b) => [b.id, { workspaceId: b.workspaceId, title: b.title }]));
}

/** Every board id, trash included (operator rebuilds of derived indexes, e.g. references). */
export function allBoardIds(): Promise<string[]> {
  return repo.allIds();
}

// ---- for modules/workspaces ----

/** Every board of a workspace (trash included): whose access to re-check when the workspace changes. */
export function boardIdsInWorkspace(workspaceId: string): Promise<string[]> {
  return repo.idsInWorkspace(workspaceId);
}

/** Board usage of a workspace for its admin console (trash counted apart; owners of live boards). */
export function workspaceBoardStats(workspaceId: string): ReturnType<typeof repo.workspaceStats> {
  return repo.workspaceStats(workspaceId, Date.now());
}

export function boardIdsInProject(projectId: string): Promise<string[]> {
  return repo.idsInProject(projectId);
}

export function countLiveBoardsInProject(projectId: string): Promise<number> {
  return repo.countLiveInProject(projectId);
}

/**
 * Every board `from` owns in the workspace (trash included) passes to `to` — someone leaving a
 * team. No quota check: the team's content must not be lost. Runs in the caller's transaction.
 */
export function transferBoardsOwnedIn(workspaceId: string, from: string, to: string): Promise<string[]> {
  return repo.transferOwnedIn(workspaceId, from, to);
}

// ---- data exports (modules/privacy) ----

export interface BoardRecord {
  id: string;
  /** 'doc' for a doc (KAI-162). */
  kind: ObjectKind;
  title: string;
  description: string;
  ownerId: string;
  workspaceId: string;
  projectId: string | null;
  linkAccess: string;
  createdAt: string;
  updatedAt: string;
  /** Set for a board in its owner's trash. */
  deletedAt: string | null;
}

/** The boards' records (trash included), in creation order. */
export async function boardRecords(ids: string[]): Promise<BoardRecord[]> {
  return (await repo.getBoardsIncludingTrash([...new Set(ids)])).map((b) => ({
    id: b.id,
    kind: b.kind,
    title: b.title,
    description: b.description,
    ownerId: b.ownerId,
    workspaceId: b.workspaceId,
    projectId: b.projectId,
    linkAccess: b.linkAccess,
    createdAt: new Date(b.createdAt).toISOString(),
    updatedAt: new Date(b.updatedAt).toISOString(),
    deletedAt: b.deletedAt === null ? null : new Date(b.deletedAt).toISOString(),
  }));
}

/** Every board the user owns, trash included. */
export function boardIdsOwnedByUser(userId: string): Promise<string[]> {
  return repo.allBoardIdsOwnedBy(userId);
}

/** The person's stars and when they last opened each board. */
export async function boardActivityOf(userId: string): Promise<{ starred: string[]; opened: Array<{ boardId: string; at: string }> }> {
  const [stars, opens] = await Promise.all([repo.starredBoardIds(userId), repo.opensOf(userId)]);
  return { starred: [...stars], opened: [...opens].map(([boardId, at]) => ({ boardId, at: new Date(at).toISOString() })) };
}

/** Upload names used as board thumbnails (restricted to `among` when given): the uploads sweep keeps them. */
export function thumbnailUploadReferences(among?: readonly string[]): Promise<string[]> {
  return repo.matchesInThumbnails(UPLOAD_REF_PATTERN, among ?? null);
}

// ---- for the public API (modules/api): the same rules as the app's own routes ----

/**
 * The boards of one workspace the user can open (`q`: title search), like GET /boards?filter=all —
 * only those of `kind` when given (the public API lists boards and docs apart). 404 unless they are in it.
 */
export async function listBoardsIn(userId: string, workspaceId: string, q = '', projectId?: string, kind?: ObjectKind): Promise<BoardSummary[]> {
  const all = await listBoards(userId, 'all', q, { workspaceId, projectId });
  return kind ? all.filter((b) => b.kind === kind) : all;
}

/**
 * The board as the user sees it (role, workspace, permissions); 404 / 403 / 451 like GET /boards/:id.
 * `kind`: a container of the other kind is 404 too (a doc is no board for the board operations).
 */
export async function boardSummaryFor(boardId: string, userId: string, kind?: ObjectKind): Promise<BoardSummary> {
  const { board, role, access } = await requireAccess(boardId, userId);
  if (kind && board.kind !== kind) throw notFound(kind === 'doc' ? 'Doc not found' : 'Board not found');
  return toSummary(board, userId, role, access);
}

/** A new board (or doc) for `ownerId` (its quota, workspace and project rules apply), as they see it. */
export async function createBoardFor(
  ownerId: string,
  fields: { title: unknown; description: unknown; workspaceId?: string; projectId?: string | null; kind?: ObjectKind },
): Promise<BoardSummary> {
  const kind = fields.kind ?? 'board';
  const board = await createBoard(ownerId, cleanTitle(fields.title, kind === 'doc' ? 'Untitled doc' : undefined), cleanDescription(fields.description), 'none', {
    workspaceId: fields.workspaceId,
    projectId: fields.projectId ?? null,
  }, undefined, kind);
  return summarize(board, ownerId, { starred: false, lastOpenedAt: null });
}

/** Moves the board to the trash, as DELETE /boards/:id (owner only). */
export async function trashBoard(boardId: string, userId: string): Promise<void> {
  const { board } = await requireAccess(boardId, userId, 'owner');
  await moveToTrash(board, userId);
}
