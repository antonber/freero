import {
  BOARD_REMOVED,
  DEFAULT_BOARD_TITLE,
  DOWNLOADS_RESTRICTED,
  isGuestId,
  LINK_PASSWORD_REQUIRED,
  LINK_POLICY_REQUIRED,
  TRASH_RETENTION_DAYS,
  type AdminTrashedBoard,
  type BoardPermissions,
  type BoardSharingSettings,
  type BoardSummary,
  type LinkAccess,
  type MoveAdjustment,
  type ObjectKind,
  type Role,
  type WorkspacePolicies,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { runExclusive } from '../../platform/jobs';
import { log, logError } from '../../platform/log';
import { hasKey, KeyUnavailableError, keysInUse } from '../keys/index';
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { getGuests, getUser, getUsers } from '../auth/index';
import {
  atLeast,
  coOwnedBoardIds,
  getMemberRole,
  getMembership,
  managesSharing,
  membershipsOf,
  ownershipTransferred,
  resolveCoOwner,
  resolveGuestRole,
  resolveRole,
  ROLE_RANK,
} from '../members/index';
import {
  closeBoardDoc,
  initBoardDoc,
  initNewBoardDoc,
  initBoardLayer,
  refreshBoardAccess,
  snapshotBoardDoc,
  snapshotBoardLayer,
  snapshotBoardLayers,
  resealBoard,
} from '../realtime/index';
import { deleteUpload } from '../uploads/index';
import { miroImportOffered } from '../importers/index';
import {
  boardAccess,
  boardAccessLoader,
  type BoardWorkspaceAccess,
  ensurePersonalWorkspace,
  getWorkspaceInfo,
  isFullMember,
  isManager,
  labelRequirement,
  labelsAvailableIn,
  lockProjectForBoard,
  lockWorkspaceForNewBoard,
  mayDownload,
  mayShareExternally,
  retentionOverrides,
  workspaceRole,
  workspaceRolesOf,
} from '../workspaces/index';
import { callOf, jitsiAvailable } from './call';
import { dockedCalls } from './callRoom';
import { boardLifecycle, boardMovedWorkspace } from './events';
import { checkLabelChange } from './labelPolicy';
import * as repo from './repo';
import type { Board } from './repo';

export type BoardFilter = 'all' | 'mine' | 'shared' | 'starred' | 'recent' | 'trash' | 'archived';
export const BOARD_FILTERS: BoardFilter[] = ['all', 'mine', 'shared', 'starred', 'recent', 'trash', 'archived'];
const DAY_MS = 86_400_000;
export const TRASH_RETENTION_MS = TRASH_RETENTION_DAYS * DAY_MS;
export const DEFAULT_TITLE = DEFAULT_BOARD_TITLE;

/** A board as an audit event's target (its title as it is now). */
/** The audit log's target for a container: a board, or a doc (KAI-162). */
export const boardTarget = (b: { id: string; title: string; kind?: ObjectKind }) => ({ type: b.kind === 'doc' ? 'doc' : 'board', id: b.id, label: b.title });

/**
 * Throws unless `user` may set the board's link to `linkAccess`: its owner or a co-owner (`manages`,
 * #122), never while an operator blocks the link, a verified address to turn it on, and within the
 * workspace's policies (links at all, up to which role, sharing outside the workspace). The link
 * policy (#39, password / expiry) is `checkLinkPolicy`, on the link as the whole change leaves it.
 */
export function checkLinkAccessChange(board: Board, manages: boolean, access: BoardWorkspaceAccess, user: { emailVerified: boolean }, linkAccess: LinkAccess): void {
  if (!manages) throw forbidden('Only the board’s owner and co-owners can change link sharing');
  if (board.linkBlocked) throw new HttpError(403, 'Freero’s moderators turned link sharing off for this board. Use the appeal link in the email we sent you.', 'link_blocked');
  if (linkAccess !== 'none' && !user.emailVerified) throw forbidden('Verify your email address before sharing by link');
  if (linkAccess !== 'none' && linkAccess !== board.linkAccess) {
    // Workspace policies: links reach people outside the workspace, and only up to a maximum role.
    if (access.maxLink === 'none') throw forbidden('This workspace doesn’t allow sharing boards by link');
    if (ROLE_RANK[linkAccess] > ROLE_RANK[access.maxLink as Exclude<LinkAccess, 'none'>])
      throw forbidden(`This workspace allows links up to “can ${access.maxLink === 'viewer' ? 'view' : 'comment'}”`);
    if (!mayShareExternally(access.workspaceRole, access.policies)) throw forbidden('This workspace doesn’t let you share its boards outside it');
  }
}

/** A change to a board's link as checked against the workspace's link policy (#39). */
export interface LinkChange {
  linkAccess?: LinkAccess;
  /** The password is set (or changed) / removed. */
  password?: 'set' | 'removed';
  /** A new expiry (epoch ms), or null for none. */
  expiresAt?: number | null;
}

/** Whether a link that works until `expiresAt` stays within `maxDays` (until the end of the last allowed day). */
const withinMaxDays = (expiresAt: number | null, maxDays: number, now: number) => expiresAt !== null && expiresAt <= now + (maxDays + 1) * DAY_MS;

/** What a workspace's link policy (#39) requires, in words (null: nothing). */
export function linkPolicyText(p: Pick<WorkspacePolicies, 'linkPassword' | 'linkMaxDays'>): string | null {
  const pw = p.linkPassword === 'required';
  const days = p.linkMaxDays;
  if (!pw && days === null) return null;
  const expiry = days === null ? '' : `an expiry within ${days === 1 ? '1 day' : `${days} days`}`;
  return `This workspace requires board links to have ${pw ? 'a password' : ''}${pw && expiry ? ' and ' : ''}${expiry}`;
}

/**
 * The workspace's link policy (#39) against the link as `change` leaves it: turning the link on
 * (or back on after it expired) or changing its role needs everything the policy requires — the
 * password and expiry may come in the same change. A link that stays as it is may still be made
 * safer step by step (a password added, a closer expiry) but never weaker: its password removed
 * or its expiry pushed beyond the limit. Links turned off are never refused, so existing links
 * that predate the policy keep working until someone changes them.
 */
export function checkLinkPolicy(board: Board, change: LinkChange, policies: Pick<WorkspacePolicies, 'linkPassword' | 'linkMaxDays'>, now = Date.now()): void {
  const required = linkPolicyText(policies);
  if (!required) return;
  const after = {
    access: change.linkAccess ?? board.storedLinkAccess,
    password: change.password ? change.password === 'set' : board.linkPasswordHash !== null,
    expiresAt: change.expiresAt !== undefined ? change.expiresAt : board.linkExpiresAt,
  };
  const liveAfter = after.access !== 'none' && (after.expiresAt === null || after.expiresAt > now);
  if (!liveAfter) return;
  const refuse = () => {
    throw new HttpError(403, required, LINK_POLICY_REQUIRED);
  };
  const needsPassword = policies.linkPassword === 'required';
  const maxDays = policies.linkMaxDays;
  const opensOrChanges = board.linkAccess === 'none' || (change.linkAccess !== undefined && change.linkAccess !== board.linkAccess);
  if (opensOrChanges) {
    if (needsPassword && !after.password) refuse();
    if (maxDays !== null && !withinMaxDays(after.expiresAt, maxDays, now)) refuse();
    return;
  }
  if (needsPassword && change.password === 'removed') refuse();
  if (maxDays !== null && change.expiresAt !== undefined && !withinMaxDays(change.expiresAt, maxDays, now)) refuse();
}

/** Whether a board's live link meets its workspace's link policy (#39; the admin console lists the ones that don't). */
export function linkProblems(board: Board, policies: Pick<WorkspacePolicies, 'linkPassword' | 'linkMaxDays'>, now = Date.now()): Array<'no_password' | 'no_expiry' | 'expiry_too_late'> {
  const out: Array<'no_password' | 'no_expiry' | 'expiry_too_late'> = [];
  if (policies.linkPassword === 'required' && board.linkPasswordHash === null) out.push('no_password');
  if (policies.linkMaxDays !== null) {
    if (board.linkExpiresAt === null) out.push('no_expiry');
    else if (!withinMaxDays(board.linkExpiresAt, policies.linkMaxDays, now)) out.push('expiry_too_late');
  }
  return out;
}

/** After a stored link change: audited, and every live socket's access re-resolved. */
export async function linkAccessChanged(board: Board, actorId: string, to: LinkAccess): Promise<void> {
  await recordAuditQuietly({ action: 'board.link_sharing_changed', workspaceId: board.workspaceId, actorId, target: boardTarget(board), metadata: { from: board.linkAccess, to } });
  await refreshBoardAccess(board.id);
}

/**
 * Shares the board by its link with at least `linkAccess` (an app's "Share with team", KAI-171):
 * a link that already lets people in as much or more is kept as it is; otherwise the same rules as
 * the share dialog apply (owner or co-owner, verified address, workspace policies — a required
 * password or expiry included — operator blocks).
 */
export async function shareByLink(boardId: string, user: { id: string; emailVerified: boolean }, linkAccess: Exclude<LinkAccess, 'none'>): Promise<{ linkAccess: LinkAccess; changed: boolean }> {
  const { board, role, access, coOwner } = await requireAccess(boardId, user.id);
  if (board.linkAccess !== 'none' && ROLE_RANK[board.linkAccess] >= ROLE_RANK[linkAccess]) return { linkAccess: board.linkAccess, changed: false };
  checkLinkAccessChange(board, managesSharing(role, coOwner), access, user, linkAccess);
  checkLinkPolicy(board, { linkAccess }, access.policies);
  await repo.updateBoardFields(board.id, { linkAccess }, Date.now());
  await linkAccessChanged(board, user.id, linkAccess);
  return { linkAccess, changed: true };
}

/** EXPORT_FORMATS a client may report (POST /boards/:id/exported). */
export const EXPORT_FORMATS = ['png', 'jpg', 'svg', 'pdf', 'csv', 'json', 'markdown', 'other'] as const;

/**
 * A client-side export (image / PDF made in the browser) reported by the web app: refused like
 * the export itself when the workspace's downloads policy forbids it, otherwise audited. The
 * server can't see a browser export, so this is as complete as the clients reporting it.
 */
export async function recordExport(boardId: string, userId: string, format: unknown): Promise<void> {
  const { board, role, access } = await requireAccess(boardId, userId);
  await requireDownload(board, userId, access, 'export', role);
  const f = (EXPORT_FORMATS as readonly unknown[]).includes(format) ? (format as string) : 'other';
  await recordAudit({ action: board.kind === 'doc' ? 'doc.exported' : 'board.exported', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { format: f } });
}

/**
 * Someone downloading a file from a board (a file card, a video or audio item; modules/uploads
 * serves it): refused like an export when the workspace's downloads policy forbids it. Returns
 * their role (what of the board they may read) and how to audit the download once it is served.
 * `userId` may be a guest id (a visitor: no actor; the guest id is kept in the event).
 */
export async function authorizeFileDownload(
  boardId: string,
  userId: string,
): Promise<{ role: Role; record(file: { name: string; upload: string }): Promise<void> }> {
  const { board, role, access } = await requireAccess(boardId, userId);
  await requireDownload(board, userId, access, 'file', role);
  const guest = isGuestId(userId);
  return {
    role,
    record: (file) =>
      recordAudit({
        action: 'board.file_downloaded',
        workspaceId: board.workspaceId,
        actorId: guest ? null : userId,
        target: boardTarget(board),
        metadata: { file: file.name, upload: file.upload, ...(guest ? { guestId: userId } : {}) },
      }),
  };
}

/**
 * Someone downloading a backup of the board (`.freero`, KAI-137; modules/backup builds it): refused
 * like any export by the workspace's downloads policy (403 `downloads_restricted`, audited). Returns
 * what the backup may carry — their role decides whether hidden frames' contents are theirs to take
 * — and how to audit it once it is built (`board.exported`, format `freero`).
 */
export async function authorizeBackup(
  boardId: string,
  userId: string,
): Promise<{
  role: Role;
  board: { id: string; title: string; description: string; createdAt: number };
  record(meta: { files: number; missingFiles: number; hiddenContent: boolean; bytes: number }): Promise<void>;
}> {
  const { board, role, access } = await requireAccess(boardId, userId);
  // A doc's document is rich text, not board content: it exports as Markdown (modules/docs).
  if (board.kind !== 'board') throw badRequest('Only boards have a .freero backup; export a doc as Markdown');
  await requireDownload(board, userId, access, 'backup', role);
  return {
    role,
    board: { id: board.id, title: board.title, description: board.description, createdAt: board.createdAt },
    record: (meta) =>
      recordAudit({ action: 'board.exported', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { format: 'freero', ...meta } }),
  };
}

/**
 * The board as its link works for one person (KAI-145): a password-protected link gives nothing to
 * someone who has not given its CURRENT password (`unlockedRev`: the revision they unlocked).
 * Expiry is already applied when the board is read (repo.toBoard).
 */
export function linkAsSeenBy<B extends Pick<Board, 'linkAccess' | 'linkPasswordHash' | 'linkPasswordRev'>>(board: B, unlockedRev: number | undefined): B {
  if (!board.linkPasswordHash || board.linkAccess === 'none' || unlockedRev === board.linkPasswordRev) return board;
  return { ...board, linkAccess: 'none' };
}

/** What the share dialog shows its owner about the link's protection. */
export const linkProtectionOf = (board: Board): NonNullable<BoardSummary['linkProtection']> => ({
  password: board.linkPasswordHash !== null,
  expiresAt: board.linkExpiresAt,
  expired: board.linkExpiresAt !== null && board.linkExpiresAt <= Date.now(),
  storedAccess: board.storedLinkAccess,
});

const linkLocked = (board: Board) => board.linkPasswordHash !== null && board.linkAccess !== 'none';

/**
 * The role of `userId` on a board and what its workspace contributes (policies, team access).
 * `userId` may be a guest id: a guest gets only the board they joined, as resolveGuestRole allows
 * (never once their session expired). `needsPassword`: no access now, but the board's link would
 * let them in once they give its password. `coOwner` (#122): they co-own it — their role is
 * 'editor' and they also manage its sharing.
 */
export async function describeAccess(
  board: Board,
  userId: string,
  /** #159: as if the workspace's key were usable (to tell that apart from no access at all). */
  ignoreKeyBlock = false,
): Promise<{ role: Role | null; access: BoardWorkspaceAccess; needsPassword: boolean; coOwner: boolean; guestEdit?: boolean }> {
  const unlocked = linkLocked(board) && userId !== board.ownerId ? (await repo.unlocksOf(userId, [board.id])).get(board.id) : undefined;
  const seen = linkAsSeenBy(board, unlocked);
  if (isGuestId(userId)) {
    const [guest, access] = await Promise.all([getGuests([userId]), boardAccess(userId, board)]);
    const joined = guest.get(userId)?.boardId === board.id;
    const role = joined ? resolveGuestRole(seen, access) : null;
    return {
      role,
      access,
      needsPassword: joined && role === null && seen !== board && resolveGuestRole(board, access) !== null,
      coOwner: false,
      // #97: still a commenter everywhere; its board socket may also edit what it adds.
      guestEdit: guestEdits(board, seen.linkAccess, role, access),
    };
  }
  const [membership, loaded] = await Promise.all([getMembership(board.id, userId), boardAccess(userId, board)]);
  const access = ignoreKeyBlock && loaded.blocked === 'key_unavailable' ? { ...loaded, blocked: null } : loaded;
  const memberRole = membership?.role ?? null;
  const role = resolveRole(seen, userId, memberRole, access);
  const needsPassword = role === null && seen !== board && resolveRole(board, userId, memberRole, access) !== null;
  return { role, access, needsPassword, coOwner: role !== null && resolveCoOwner(board, userId, membership, access) };
}

/** #97: would a guest joining this board by its link edit it (guestEdits, before any password)? */
export async function guestEditFor(board: Board): Promise<boolean> {
  const access = await boardAccess('', board);
  return guestEdits(board, board.linkAccess, resolveGuestRole(board, access), access);
}

/** May visitors without an account join this board by its link, and as what (null: no)? */
export async function guestRoleFor(board: Board): Promise<'viewer' | 'commenter' | null> {
  // The access a workspace gives someone who is in none of its lists (any id outside it will do).
  return resolveGuestRole(board, await boardAccess('', board));
}

export async function roleOn(board: Board, userId: string): Promise<Role | null> {
  return (await describeAccess(board, userId)).role;
}

/**
 * 451 for a board an operator took down — only to someone who could open it otherwise, so it
 * tells nobody else that the board exists.
 */
export async function removedFor(boardId: string, userId: string): Promise<boolean> {
  const board = await repo.getBoardAnyState(boardId);
  if (!board || board.removedAt === null || board.deletedAt !== null) return false;
  return (await describeAccess(board, userId)).role !== null;
}

export const boardRemoved = () =>
  new HttpError(451, 'This board was removed by Freero’s moderators while they review a report.', BOARD_REMOVED);

/**
 * Loads a board and checks the user's role: 404 if missing, 451 if taken down, 403 if below `min`.
 * `coOwner` (#122): see describeAccess; `managesSharing(role, coOwner)` is who manages sharing.
 */
export async function requireAccess(
  boardId: string,
  userId: string,
  min: Role = 'viewer',
): Promise<{ board: Board; role: Role; access: BoardWorkspaceAccess; coOwner: boolean }> {
  const board = await repo.getBoard(boardId);
  if (!board) throw (await removedFor(boardId, userId)) ? boardRemoved() : notFound('Board not found');
  const { role, access, needsPassword, coOwner } = await describeAccess(board, userId);
  if (!role && needsPassword) throw new HttpError(403, 'This board’s link asks for a password', LINK_PASSWORD_REQUIRED);
  // #159: closed only because its workspace's key can't be used — said so to whoever could open it otherwise.
  if (!role && access.blocked === 'key_unavailable' && (await describeAccess(board, userId, true)).role) throw new KeyUnavailableError(board.workspaceId);
  if (!role) throw forbidden();
  if (!atLeast(role, min)) throw forbidden(min === 'owner' ? 'Only the board owner can do that' : `You need ${min} access to do that`);
  return { board, role, access, coOwner };
}

/**
 * The board's own "Viewers and commenters can copy and export" (#123): may someone with `role`
 * take its content out? Editors, co-owners and the owner always may (the workspace's policy still
 * applies to them); guests are viewers or commenters. A label (#158) with viewerExports 'off' says never.
 */
export const boardLetsCopy = (board: Pick<Board, 'viewersCanExport'>, role: Role | null, access?: Pick<BoardWorkspaceAccess, 'label'>): boolean =>
  (board.viewersCanExport && access?.label?.caps.viewerExports !== 'off') || atLeast(role, 'editor');

/**
 * May `userId` archive or unarchive the board (#153)? Its owner — by who they are, since an
 * archived board gives everyone at most 'viewer' — or an owner / content admin of its workspace
 * (`workspaceRole` is the content role: an admin without the content scope reads 'member').
 */
export const mayArchive = (board: Board, userId: string, access: BoardWorkspaceAccess): boolean =>
  !access.blocked && (board.ownerId === userId || (access.team !== null && isManager(access.workspaceRole)));

/** What the user may do beyond their role, under the workspace's policies (each re-checked where it's done). */
export function permissionsFor(board: Board, userId: string, role: Role, access: BoardWorkspaceAccess, coOwner = false): BoardPermissions {
  const isOwner = board.ownerId === userId;
  const admin = isManager(access.workspaceRole);
  const manages = managesSharing(role, coOwner);
  const copies = boardLetsCopy(board, role, access);
  return {
    // A board can be stricter than its workspace (#123), never looser.
    canExport: mayDownload(access.workspaceRole, access.policies) && copies,
    canShareExternally: atLeast(role, 'editor') && mayShareExternally(access.workspaceRole, access.policies),
    maxLinkAccess: access.maxLink,
    canMove: isOwner || admin,
    canTransfer: isOwner || admin,
    canArchive: mayArchive(board, userId, access),
    guestLinks: access.anonymousLinks && !access.outsidersBlocked,
    jitsiCalls: jitsiAvailable(),
    ...(dockedCalls() ? { dockedCalls: dockedCalls()! } : {}),
    liveEmbeds: access.policies.liveEmbeds !== 'off',
    embedOrigins: getConfig().embedExtraOrigins,
    boardEmbeds: access.policies.boardEmbeds !== 'off',
    // #139: GIF search where the operator configured a provider and the workspace allows it.
    gifs: getConfig().gifs !== null && access.policies.gifs !== 'off',
    // #171: Place from Figma where the operator registered a Figma app (modules/figma).
    figma: getConfig().figma !== null,
    // #62: import a Miro board with the person's own token (modules/importers), unless the operator turned it off.
    miroImport: miroImportOffered(),
    manageSharing: manages,
    invite: manages || (atLeast(role, 'editor') && board.editorsCanShare),
    canCopy: copies,
    guestEditing: guestEditingAllowed(access),
    ...(access.policies.linkPassword === 'required' || access.policies.linkMaxDays !== null
      ? { linkPolicy: { passwordRequired: access.policies.linkPassword === 'required', maxDays: access.policies.linkMaxDays } }
      : {}),
  };
}

/**
 * #178: may people keep a copy of the board on their devices (to open and edit it offline)? The
 * workspace's `offlineCopies` policy (a label may cap it): 'all' yes, 'off' no, 'unkeyed' (default)
 * unless the workspace keeps its boards under its own encryption key (#159) — a key on a device
 * can't promise what the workspace's key does. Boards only (docs have no offline copy yet).
 */
export async function mayKeepOffline(board: Pick<Board, 'kind' | 'workspaceId'>, access: Pick<BoardWorkspaceAccess, 'policies'>): Promise<boolean> {
  const policy = access.policies.offlineCopies ?? 'unkeyed';
  if (board.kind !== 'board' || policy === 'off') return false;
  if (policy === 'all') return true;
  return !((await keysInUse()) && (await hasKey(board.workspaceId)));
}

/**
 * Throws unless the person may turn embedding on other sites on or off (#2): the owner or a
 * co-owner (`manages`, #122), like the link; turning it ON also needs the workspace's
 * `boardEmbeds` policy. Turning it off is always possible.
 */
export function checkEmbeddingChange(board: Board, manages: boolean, access: BoardWorkspaceAccess, embeddable: boolean): void {
  if (!manages) throw forbidden('Only the board’s owner and co-owners can change embedding');
  if (board.kind !== 'board') throw badRequest('Only boards can be embedded on other sites');
  if (embeddable && !board.embeddable && access.policies.boardEmbeds === 'off')
    throw forbidden('This workspace doesn’t allow embedding its boards on other sites');
}

/**
 * #97: may a board of this workspace let guests on its "can edit" link edit at all? The operator
 * (GUEST_EDITING), the workspace's `guestEditing` policy (an organisation's floor applied) and its
 * letting visitors without an account in.
 */
export const guestEditingAllowed = (access: Pick<BoardWorkspaceAccess, 'policies' | 'anonymousLinks' | 'outsidersBlocked'>): boolean =>
  getConfig().guestEditing && access.policies.guestEditing !== 'off' && access.anonymousLinks && !access.outsidersBlocked;

/** The board's link as its workspace caps it (`maxLink`). */
const LINK_ORDER: readonly LinkAccess[] = ['none', 'viewer', 'commenter', 'editor'];
const cappedLink = (link: LinkAccess, access: Pick<BoardWorkspaceAccess, 'maxLink'>): LinkAccess =>
  LINK_ORDER.indexOf(link) > LINK_ORDER.indexOf(access.maxLink) ? access.maxLink : link;

/**
 * #97: does a guest whose role on `board` is `role` edit it? Only a commenter guest (a guest on a
 * "can edit" link: resolveGuestRole caps it at commenter), on a board that lets guests edit, while
 * its link — as this guest sees it, the workspace's cap applied — is "can edit" and the workspace
 * and operator allow it.
 */
export function guestEdits(board: Pick<Board, 'guestsCanEdit' | 'archivedAt'>, seenLink: LinkAccess, role: Role | null, access: BoardWorkspaceAccess): boolean {
  return role === 'commenter' && board.guestsCanEdit && !board.archivedAt && seenLink !== 'none' && cappedLink(seenLink, access) === 'editor' && guestEditingAllowed(access);
}

/**
 * Throws unless guest editing may be turned ON (#97): the workspace and operator allow it and the
 * link (as the same change leaves it) is "can edit". Turning it off is always possible.
 */
export function checkGuestEditingChange(board: Board, access: BoardWorkspaceAccess, on: boolean, linkAfter: LinkAccess): void {
  if (!on || board.guestsCanEdit) return;
  if (!guestEditingAllowed(access)) throw new HttpError(403, 'Guests can’t edit boards in this workspace', 'guest_editing_off');
  if (cappedLink(linkAfter, access) !== 'editor') throw new HttpError(400, 'Set the link to “Can edit” first: guests edit only through an edit link', 'guest_editing_needs_edit_link');
}

/** Validates PATCH /boards/:id `sharing` (#123): the settings it changes. */
export function cleanSharing(v: unknown): Partial<BoardSharingSettings> {
  if (v === undefined || v === null) return {};
  if (typeof v !== 'object' || Array.isArray(v)) throw badRequest('sharing must be an object');
  const out: Partial<BoardSharingSettings> = {};
  for (const k of ['editorsCanShare', 'viewersCanExport', 'guestsCanEdit'] as const) {
    const x = (v as Record<string, unknown>)[k];
    if (x === undefined) continue;
    if (typeof x !== 'boolean') throw badRequest(`sharing.${k} must be true or false`);
    out[k] = x;
  }
  return out;
}

/** After a stored change of the board's sharing settings (#123): audited, with what changed. */
export async function sharingSettingsChanged(board: Board, actorId: string, patch: Partial<BoardSharingSettings>): Promise<void> {
  const changed = (Object.keys(patch) as Array<keyof BoardSharingSettings>).filter((k) => patch[k] !== board[k]);
  if (!changed.length) return;
  await recordAuditQuietly({
    action: 'board.sharing_settings_changed',
    workspaceId: board.workspaceId,
    actorId,
    target: boardTarget(board),
    metadata: Object.fromEntries(changed.flatMap((k) => [[`${k}.from`, board[k]], [`${k}.to`, patch[k]!]])),
  });
  // #97: connected guests start or stop editing on their open sockets.
  if (changed.includes('guestsCanEdit')) await refreshBoardAccess(board.id);
}

/** After a stored embedding change: audited, and every live socket re-checked (embeds close). */
export async function embeddingChanged(board: Board, actorId: string, embeddable: boolean): Promise<void> {
  await recordAuditQuietly({ action: 'board.embedding_changed', workspaceId: board.workspaceId, actorId, target: boardTarget(board), metadata: { from: board.embeddable, to: embeddable } });
  await refreshBoardAccess(board.id);
}

/**
 * Whether other sites may frame the board now (#2) and what a visitor without an account may do
 * there. Null when there is no such board in service, it is a doc, or embedding is off — by its
 * owner or by its workspace's policy: one answer, so it tells nobody which. `visitor` is 'viewer'
 * exactly when the board's link would let a visitor without an account in as a guest (no
 * password): an embed never shows more than the link would, and never lets a visitor write.
 */
export async function embeddingOf(boardId: string): Promise<{ board: Board; visitor: 'viewer' | null } | null> {
  const board = await repo.getBoard(boardId);
  if (!board || board.kind !== 'board' || !board.embeddable) return null;
  const access = await boardAccess('', board);
  if (access.policies.boardEmbeds === 'off') return null;
  const visitor = board.linkPasswordHash === null && resolveGuestRole(board, access) !== null ? 'viewer' : null;
  return { board, visitor };
}

/** How someone tried to take a board's content out (recorded with a refusal). */
export type DownloadVia = 'export' | 'duplicate' | 'template' | 'file' | 'outline' | 'api' | 'ai' | 'backup' | 'move';

/**
 * The one check of what may take a board's content out of its workspace's control: exports,
 * duplicates, templates, backups, file downloads, moves to another workspace and machine-readable
 * reads (the outline, the public API, MCP and AI — KAI-197). Two rules, the stricter wins: the
 * workspace's "downloads" policy, and the board's own "Viewers and commenters can copy and export"
 * (#123: `role` viewer or commenter, guests included). Refusals answer 403 `downloads_restricted`
 * and are audited. Personal workspaces have no policies, so only the board's setting applies there.
 */
export async function requireDownload(board: Board, userId: string, access: BoardWorkspaceAccess, via: DownloadVia, role: Role | null): Promise<void> {
  const workspaceAllows = mayDownload(access.workspaceRole, access.policies);
  const boardAllows = boardLetsCopy(board, role, access);
  if (workspaceAllows && boardAllows) return;
  // A visitor without an account is no actor; their guest id is kept in the event.
  const guest = isGuestId(userId);
  await recordAuditQuietly({
    action: 'board.download_refused',
    workspaceId: board.workspaceId,
    actorId: guest ? null : userId,
    target: boardTarget(board),
    metadata: { via, by: workspaceAllows ? 'board' : 'workspace', ...(guest ? { guestId: userId } : {}) },
  });
  throw new HttpError(
    403,
    workspaceAllows ? 'The board’s owner doesn’t let viewers and commenters copy, export or download it' : 'This workspace doesn’t allow you to export, download or copy its boards',
    DOWNLOADS_RESTRICTED,
  );
}

export async function toSummary(
  board: Board,
  userId: string,
  role: Role,
  access: BoardWorkspaceAccess,
  extra?: { starred?: boolean; lastOpenedAt?: number | null; ownerName?: string; member?: boolean; coOwner?: boolean },
): Promise<BoardSummary> {
  const starred = extra?.starred ?? (await repo.isStarred(board.id, userId));
  const membership = extra?.member === undefined || extra.coOwner === undefined ? await getMembership(board.id, userId) : null;
  const member = extra?.member ?? membership !== null;
  const coOwner = extra?.coOwner ?? (role !== 'owner' && resolveCoOwner(board, userId, membership, access));
  const manages = managesSharing(role, coOwner);
  const lastOpenedAt =
    extra && 'lastOpenedAt' in extra ? (extra.lastOpenedAt ?? null) : await repo.lastOpenedAt(board.id, userId);
  const ownerName = extra?.ownerName ?? (await getUser(board.ownerId))?.name ?? 'Unknown';
  return {
    id: board.id,
    kind: board.kind,
    title: board.title,
    description: board.description,
    ownerId: board.ownerId,
    ownerName,
    role,
    starred,
    thumbnail: board.thumbnail,
    linkAccess: board.linkAccess,
    createdAt: board.createdAt,
    updatedAt: board.updatedAt,
    lastOpenedAt,
    workspaceId: board.workspaceId,
    projectId: board.projectId,
    team: access.team,
    member,
    permissions: { ...permissionsFor(board, userId, role, access, coOwner), offline: await mayKeepOffline(board, access) },
    ...(board.linkBlocked ? { linkBlocked: true } : {}),
    ...(manages ? { linkProtection: linkProtectionOf(board) } : {}),
    call: callOf(board),
    embeddable: board.embeddable,
    ...(coOwner ? { coOwner: true } : {}),
    sharing: { editorsCanShare: board.editorsCanShare, viewersCanExport: board.viewersCanExport, guestsCanEdit: board.guestsCanEdit },
    ...(board.deletedAt !== null ? { deletedAt: board.deletedAt, purgeAt: board.deletedAt + access.trashRetentionDays * DAY_MS } : {}),
    ...(board.archivedAt !== null ? { archivedAt: board.archivedAt } : {}),
    ...(access.label ? { label: access.label } : {}),
  };
}

/** The summary of a board for the user (re-reads their role and the workspace context). */
export async function summarize(board: Board, userId: string, extra?: { starred?: boolean; lastOpenedAt?: number | null }): Promise<BoardSummary> {
  const { role, access, coOwner } = await describeAccess(board, userId);
  if (!role) throw forbidden();
  return toSummary(board, userId, role, access, { ...extra, coOwner });
}

/**
 * The boards a user can open, scoped to one workspace (see the contract in @freero/shared api.ts):
 * the workspace's boards they can open, plus — for 'shared', 'starred', 'recent', and 'all' in the
 * personal workspace — boards shared with them directly from workspaces they are not in. A board of a workspace the user is
 * not in never appears unless they hold access to that board itself (a direct invite or its link).
 */
export async function listBoards(
  userId: string,
  filter: BoardFilter,
  q: string,
  scope: { workspaceId?: string; projectId?: string } = {},
): Promise<BoardSummary[]> {
  const workspaceId = scope.workspaceId || (await ensurePersonalWorkspace(userId));
  const myWorkspaces = await workspaceRolesOf(userId);
  if (!myWorkspaces.has(workspaceId)) throw notFound('Workspace not found');
  if (filter === 'trash') return listTrash(userId, workspaceId, q);

  const [memberships, opens, stars, ws, unlocks, coOwned] = await Promise.all([
    membershipsOf(userId),
    repo.opensOf(userId),
    repo.starredBoardIds(userId),
    getWorkspaceInfo(workspaceId),
    repo.unlocksOf(userId),
    coOwnedBoardIds(userId),
  ]);
  const inWorkspace = filter === 'shared' ? [] : await repo.boardsInWorkspace(workspaceId);
  const seen = new Set(inWorkspace.map((b) => b.id));
  // Boards reached from outside — only ones in workspaces the user is not in. The personal
  // workspace's home shows them too: it is where "everything that isn't a team's" lives.
  const withOutside = filter === 'shared' || filter === 'starred' || filter === 'recent' || (filter === 'all' && ws?.kind === 'personal');
  const outsideIds = withOutside ? [...new Set([...memberships.keys(), ...opens.keys(), ...stars])].filter((id) => !seen.has(id)) : [];
  const outside = (await repo.getBoards(outsideIds)).filter((b) => !myWorkspaces.has(b.workspaceId));
  // #153: archived boards are out of every list but their own.
  const boards = [...inWorkspace, ...outside].filter((b) => (b.archivedAt !== null) === (filter === 'archived'));

  const accessOf = await boardAccessLoader(userId, [...new Set(boards.map((b) => b.workspaceId))]);
  const owners = await getUsers(boards.map((b) => b.ownerId));
  const needle = q.trim().toLowerCase();
  const out: BoardSummary[] = [];
  for (const board of boards) {
    if (scope.projectId && board.projectId !== scope.projectId) continue;
    const access = accessOf(board);
    const memberRole = memberships.get(board.id) ?? null;
    const role = resolveRole(linkAsSeenBy(board, unlocks.get(board.id)), userId, memberRole, access);
    if (!role) continue; // e.g. a team board in a private project, or link access revoked / locked
    const membership = memberRole && memberRole !== 'owner' ? { role: memberRole, coOwner: coOwned.has(board.id) } : null;
    if (filter === 'mine' && role !== 'owner') continue;
    if (filter === 'starred' && !stars.has(board.id)) continue;
    if (filter === 'recent' && !opens.has(board.id)) continue;
    if (needle && !board.title.toLowerCase().includes(needle)) continue;
    out.push(
      await toSummary(board, userId, role, access, {
        starred: stars.has(board.id),
        member: memberships.has(board.id),
        coOwner: role !== 'owner' && resolveCoOwner(board, userId, membership, access),
        lastOpenedAt: opens.get(board.id) ?? null,
        ownerName: owners.get(board.ownerId)?.name ?? 'Unknown',
      }),
    );
  }
  if (filter === 'recent') out.sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0));
  else out.sort((a, b) => b.updatedAt - a.updatedAt);
  return out;
}

export function cleanTitle(v: unknown, fallback = DEFAULT_TITLE): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string') throw badRequest('title must be a string');
  const t = v.trim().slice(0, 200);
  return t || fallback;
}

export function cleanDescription(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest('description must be a string');
  return v.slice(0, 2000);
}

/**
 * Runs `write` (which adds one live board for `ownerId`) only if the owner is below the board
 * quota. The count and the write happen in one transaction under the owner's quota lock, so
 * concurrent creates/duplicates/restores of one user can never land over the limit (a plain
 * count-then-insert lets every parallel request pass the same count). Joins the caller's
 * transaction if there is one; the lock is then held until that one ends.
 */
function withinBoardQuota<T>(ownerId: string, refusal: (max: number) => string, write: () => Promise<T>): Promise<T> {
  return repo.transaction(async () => {
    const max = getConfig().maxBoardsPerUser;
    await repo.lockOwnerQuota(ownerId);
    if ((await repo.countLiveBoardsOwnedBy(ownerId)) >= max) throw forbidden(refusal(max));
    return write();
  });
}

/** Where a new board goes: a workspace (default: the owner's personal one) and optionally a project. */
export interface BoardPlace {
  workspaceId?: string;
  projectId?: string | null;
  /** #158: the label it carries (a copy keeps its source's); default: the workspace's default label. */
  labelId?: string | null;
}

/**
 * #158: the label a board keeps when its content lands in `workspaceId` (a copy, a move): its own
 * where that workspace may carry it; none when the label caps nothing; otherwise 403 — a label's
 * caps can't be shed by copying or moving the board somewhere that doesn't know them.
 */
export async function labelInTarget(label: BoardWorkspaceAccess['label'], workspaceId: string): Promise<string | null> {
  if (!label) return null;
  if ((await labelsAvailableIn(workspaceId)).some((l) => l.id === label.id)) return label.id;
  if (Object.keys(label.caps).length === 0) return null;
  throw new HttpError(403, `This board is labelled ${label.name}: it can only be copied or moved where that label applies.`, 'label_restricted');
}

export async function createBoard(
  ownerId: string,
  title: string,
  description: string,
  linkAccess: LinkAccess = 'none',
  place: BoardPlace = {},
  /** The board it is a copy of (duplicates): carried by its `board.created` event. */
  copyOf?: string,
  /** What it holds (KAI-162): a board, or a doc (modules/docs). Same quota, same rules. */
  kind: ObjectKind = 'board',
): Promise<Board> {
  const workspaceId = place.workspaceId || (await ensurePersonalWorkspace(ownerId));
  const projectId = place.projectId || null;
  const labelId = place.labelId ?? (await labelRequirement(workspaceId)).defaultLabelId;
  return withinBoardQuota(
    ownerId,
    (max) => `You have reached the limit of ${max} boards. Delete boards you no longer need to create new ones.`,
    async () => {
      // Holds the workspace (and project) until this transaction ends, so neither is deleted
      // underneath the new board.
      await lockWorkspaceForNewBoard(workspaceId, ownerId);
      if (projectId) await lockProjectForBoard(projectId, workspaceId, ownerId);
      const now = Date.now();
      const board: Board = {
        id: newId(10),
        kind,
        title,
        description,
        ownerId,
        linkAccess,
        thumbnail: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
        workspaceId,
        projectId,
        removedAt: null,
        linkBlocked: false,
        storedLinkAccess: linkAccess,
        linkPasswordHash: null,
        linkPasswordRev: 0,
        linkExpiresAt: null,
        callUrl: null,
        callJitsi: false,
        embeddable: false,
        editorsCanShare: true,
        viewersCanExport: true,
        guestsCanEdit: false,
        deletedBy: null,
        archivedAt: null,
        archivedBy: null,
        labelId,
      };
      await repo.insertBoard(board);
      // A new board starts with today's defaults (line jumps on); a copy is its source's content
      // (the caller stores it next), and boards from before a default keep their own look.
      if (kind === 'board' && !copyOf) await initNewBoardDoc(board.id);
      await recordAudit({ action: kind === 'doc' ? 'doc.created' : 'board.created', workspaceId, actorId: ownerId, target: boardTarget(board), metadata: { projectId } });
      await repo.appendBoardEvent({ type: 'board.created', boardId: board.id, workspaceId, actorId: ownerId, title, ...(copyOf ? { copyOf } : {}), ...(kind === 'doc' ? { kind } : {}) });
      return board;
    },
  );
}

/**
 * Moves a board into another project of its workspace (null: the workspace root). Its owner or the
 * workspace's owners/admins only: taking a board out of a private project opens it to the team.
 * Everyone connected is re-checked at once (moving into a private project can cut access).
 */
export async function moveToProject(board: Board, userId: string, projectId: string | null): Promise<void> {
  const role = await workspaceRole(board.workspaceId, userId);
  if (board.ownerId !== userId && !isManager(role)) throw forbidden('Only the board owner or a workspace admin can move it');
  const to = await repo.transaction(async () => {
    const project = projectId ? await lockProjectForBoard(projectId, board.workspaceId, userId) : null;
    if (!(await repo.setProject(board.id, projectId))) throw notFound('Board not found');
    await recordAudit({ action: 'board.moved', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { from: board.projectId, to: projectId } });
    await repo.appendBoardEvent({ type: 'board.moved', boardId: board.id, workspaceId: board.workspaceId, actorId: userId, title: board.title, to: project?.name ?? null });
    return project?.name ?? null;
  });
  await refreshBoardAccess(board.id);
  await boardLifecycle({ boardId: board.id, actorId: userId, action: 'moved', to });
}

/**
 * Moves a board into another workspace (#124) and a project there (or none): its owner only, when
 * they may create boards in the target (a full member of a team, or their own personal workspace)
 * and the SOURCE's downloads policy lets them take its content out. The board keeps its id, content,
 * comments, files, versions, members and links; from the next request on it is the target's:
 * team access of the old workspace ends, the target's policies decide everything, and what they
 * forbid is turned off here (a link above its maximum is lowered; a link the owner couldn't share
 * there, or without the password / expiry it requires, is turned off; embedding when it doesn't
 * allow it). Both workspaces audit it and get a `board.moved` event; connected people are
 * re-checked on every instance; other modules adjust what they keep per workspace (trackers pause
 * issues linked through the old workspace's connections).
 */
export async function moveToWorkspace(board: Board, userId: string, body: { workspaceId?: unknown; projectId?: unknown }): Promise<{ board: Board; adjusted: MoveAdjustment[] }> {
  const targetId = body.workspaceId;
  if (typeof targetId !== 'string' || !targetId) throw badRequest('workspaceId is required');
  if (body.projectId !== undefined && body.projectId !== null && typeof body.projectId !== 'string') throw badRequest('projectId must be a project id or null');
  const projectId = (body.projectId as string | null | undefined) || null;
  if (board.ownerId !== userId) throw forbidden('Only the board’s owner can move it to another workspace');
  if (targetId === board.workspaceId) throw badRequest('The board is already in that workspace');
  const target = await getWorkspaceInfo(targetId);
  if (!target || (target.kind === 'personal' && target.personalOf !== userId)) throw notFound('Workspace not found');
  // Moving a board out takes its content out of the source workspace's control.
  const here = await boardAccess(userId, board);
  await requireDownload(board, userId, here, 'move', 'owner');
  const labelId = (await labelInTarget(here.label, targetId)) ?? (await labelRequirement(targetId)).defaultLabelId;

  // What the target's policies forbid, as the owner would have them there.
  const there = await boardAccess(userId, { workspaceId: targetId, projectId, labelId });
  const adjusted: MoveAdjustment[] = [];
  let linkAccess: LinkAccess | undefined;
  const stored = board.storedLinkAccess;
  if (stored !== 'none' && !board.linkBlocked) {
    const capped = ROLE_RANK[stored] > (there.maxLink === 'none' ? 0 : ROLE_RANK[there.maxLink]) ? there.maxLink : stored;
    const off = capped === 'none' || !mayShareExternally(there.workspaceRole, there.policies) || linkProblems(board, there.policies).length > 0;
    if (off) {
      linkAccess = 'none';
      adjusted.push({ kind: 'link_off' });
    } else if (capped !== stored) {
      linkAccess = capped;
      adjusted.push({ kind: 'link_lowered', to: capped });
    }
  }
  const embeddingOff = board.embeddable && there.policies.boardEmbeds === 'off';
  if (embeddingOff) adjusted.push({ kind: 'embedding_off' });

  // #159: the stored content is sealed for the target's key (or opened, for a target without one)
  // before the move, so it never depends on the source's key afterwards; refused (403
  // workspace_key_unavailable) when either key can't be used. Again after it, for saves in between.
  await resealBoard(board.id, targetId);
  const now = Date.now();
  const fromName = (await getWorkspaceInfo(board.workspaceId))?.name ?? null;
  const toName = target.kind === 'personal' ? 'Personal' : target.name;
  await repo.transaction(async () => {
    // A full member there (not a guest, not deactivated), and the workspace / project kept from
    // being deleted until this commits.
    await lockWorkspaceForNewBoard(targetId, userId);
    const project = projectId ? await lockProjectForBoard(projectId, targetId, userId) : null;
    if (!(await repo.moveToWorkspace(board.id, { workspaceId: targetId, projectId, labelId, ...(linkAccess ? { linkAccess } : {}), ...(embeddingOff ? { embeddable: false } : {}) }, now)))
      throw notFound('Board not found');
    const detail = { adjusted: adjusted.map((a) => a.kind) };
    await recordAudit({
      action: 'board.moved_workspace',
      workspaceId: board.workspaceId,
      actorId: userId,
      target: boardTarget(board),
      metadata: { toWorkspace: targetId, toWorkspaceName: toName, ...detail },
    });
    await recordAudit({
      action: 'board.moved_workspace',
      workspaceId: targetId,
      actorId: userId,
      target: boardTarget(board),
      metadata: { fromWorkspace: board.workspaceId, fromWorkspaceName: fromName, toProject: projectId, ...detail },
    });
    await repo.appendBoardEvent({ type: 'board.moved', boardId: board.id, workspaceId: board.workspaceId, actorId: userId, title: board.title, to: null, toWorkspace: targetId });
    await repo.appendBoardEvent({ type: 'board.moved', boardId: board.id, workspaceId: targetId, actorId: userId, title: board.title, to: project?.name ?? null, fromWorkspace: board.workspaceId });
  });
  await resealBoard(board.id).catch((e) => logError(`boards: resealing board ${board.id} after its move failed; rows saved meanwhile stay under the key they name`, e));
  // The target's policies apply from now on: everyone connected is re-checked on every instance.
  await refreshBoardAccess(board.id);
  adjusted.push(...(await boardMovedWorkspace({ boardId: board.id, actorId: userId, fromWorkspaceId: board.workspaceId, toWorkspaceId: targetId })));
  await boardLifecycle({ boardId: board.id, actorId: userId, action: 'moved_workspace', to: toName });
  const moved = await repo.getBoard(board.id);
  if (!moved) throw notFound('Board not found');
  return { board: moved, adjusted };
}

/**
 * Hands a board to another person, in one transaction (subject to their board quota):
 * - team workspace: to a member who is not a guest; it stays where it is;
 * - personal workspace: to someone already invited to the board; it moves to THEIR personal
 *   workspace (a personal workspace only ever holds its owner's boards).
 * The previous owner keeps editor access through a membership. The board owner or the
 * workspace's owners/admins may do it.
 */
export async function transferBoard(board: Board, actorId: string, targetId: unknown): Promise<Board> {
  if (typeof targetId !== 'string' || !targetId) throw badRequest('userId is required');
  if (targetId === board.ownerId) throw badRequest('They already own this board');
  const [actorWsRole, targetWsRole, ws, target] = await Promise.all([
    workspaceRole(board.workspaceId, actorId),
    workspaceRole(board.workspaceId, targetId),
    getWorkspaceInfo(board.workspaceId),
    getUser(targetId),
  ]);
  if (board.ownerId !== actorId && !isManager(actorWsRole)) throw forbidden('Only the board owner or a workspace admin can transfer it');
  if (!ws || !target) throw notFound('That person was not found');
  let workspaceId = board.workspaceId;
  let projectId = board.projectId;
  if (ws.kind === 'team') {
    if (!isFullMember(targetWsRole)) throw badRequest(`${target.name} must be a member (not a guest) of this workspace to own its boards`);
  } else {
    if (!(await getMemberRole(board.id, targetId))) throw badRequest(`Invite ${target.name} to the board first`);
    workspaceId = await ensurePersonalWorkspace(targetId);
    projectId = null;
  }
  const previousOwner = board.ownerId;
  await withinBoardQuota(
    targetId,
    (max) => `${target.name} has reached the limit of ${max} boards and can’t receive this one.`,
    async () => {
      if (!(await repo.setOwner(board.id, targetId, workspaceId, projectId, Date.now()))) throw notFound('Board not found');
      await ownershipTransferred(board.id, targetId, previousOwner, 'editor');
      await recordAudit({
        action: 'board.transferred',
        workspaceId: board.workspaceId,
        actorId,
        target: boardTarget(board),
        metadata: { from: previousOwner, to: targetId, toEmail: target.email, movedToWorkspace: workspaceId === board.workspaceId ? null : workspaceId },
      });
    },
  );
  await refreshBoardAccess(board.id);
  return { ...board, ownerId: targetId, workspaceId, projectId };
}

// ---- trash ----

async function listTrash(userId: string, workspaceId: string, q: string): Promise<BoardSummary[]> {
  const needle = q.trim().toLowerCase();
  const [boards, me] = await Promise.all([repo.trashedBoardsOf(userId, workspaceId), getUser(userId)]);
  const accessOf = await boardAccessLoader(userId, [workspaceId]);
  const out: BoardSummary[] = [];
  for (const b of boards) {
    if (needle && !b.title.toLowerCase().includes(needle)) continue;
    // Only owners see (and restore) trashed boards; stars/opens don't matter here.
    out.push(await toSummary(b, userId, 'owner', accessOf(b), { starred: false, lastOpenedAt: null, ownerName: me?.name ?? 'Unknown', member: false }));
  }
  return out;
}

/**
 * Moves a live board to the trash: it disappears from every list and stops resolving for access
 * (so new sockets are refused), and everyone connected is disconnected. Its content is kept
 * exactly as it was, including edits made in the last moments before the delete.
 */
export async function moveToTrash(board: Board, actorId: string, now = Date.now()): Promise<void> {
  const trashed = await repo.transaction(async () => {
    if (!(await repo.trashBoard(board.id, now, actorId))) return false; // trashed meanwhile by another request
    await recordAudit({ action: 'board.trashed', workspaceId: board.workspaceId, actorId, target: boardTarget(board) });
    await repo.appendBoardEvent({ type: 'board.trashed', boardId: board.id, workspaceId: board.workspaceId, actorId, title: board.title });
    return true;
  });
  if (!trashed) return;
  await closeKeepingContent(board.id, 'deleted');
  await boardLifecycle({ boardId: board.id, actorId, action: 'trashed' });
}

/**
 * Disconnects everyone from a board that no longer resolves for access (trashed, taken down) on
 * every instance, keeping its content exactly as it was. The live doc may hold edits not saved
 * yet (saves are debounced) and closing the room drops them. Take the live state first, then
 * close (which also waits for a save in flight), then store that state last, so nothing older
 * lands after it. Nobody can rejoin in between: the board no longer resolves for access.
 * The same for its layers (hidden frames' contents, private drafts, sealed ballots): restoring
 * the board brings them back exactly as they were.
 */
export async function closeKeepingContent(boardId: string, why: 'deleted' | 'removed'): Promise<void> {
  const state = await snapshotBoardDoc(boardId);
  const layers = await snapshotBoardLayers(boardId);
  await closeBoardDoc(boardId, why);
  if (state) await initBoardDoc(boardId, state);
  for (const l of layers) await initBoardLayer(boardId, l.layer, l.state);
}

/** Owner only: takes a board out of the trash (subject to the board quota). */
export async function restoreFromTrash(boardId: string, userId: string, now = Date.now()): Promise<Board> {
  const board = await repo.getBoardIncludingTrash(boardId);
  // Not yours / not there: the same answer, so the trash leaks nothing about other people's boards.
  // A board taken down by an operator stays with them until they restore it.
  if (!board || board.deletedAt === null || board.ownerId !== userId || board.removedAt !== null) throw notFound('Board not found in your trash');
  await withinBoardQuota(
    userId,
    (max) => `You have reached the limit of ${max} boards. Delete boards you no longer need to restore this one.`,
    async () => {
      if (!(await repo.restoreBoard(board.id, now))) throw notFound('Board not found in your trash');
      await recordAudit({ action: 'board.restored', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board) });
      await repo.appendBoardEvent({ type: 'board.restored', boardId: board.id, workspaceId: board.workspaceId, actorId: userId, title: board.title });
    },
  );
  await boardLifecycle({ boardId: board.id, actorId: userId, action: 'restored' });
  return { ...board, deletedAt: null };
}

// ---- the admin inventory (#152) ----

/** The workspace's live boards for its content admins (the caller checked the scope): what the inventory lists. */
export async function inventoryBoards(workspaceId: string): Promise<Array<Board & { lastActivityAt: number; publicLink: boolean }>> {
  const [boards, accessOf] = await Promise.all([repo.inventoryOf(workspaceId), boardAccessLoader('', [workspaceId])]);
  // Visitors without an account get in by its link exactly when a guest would (resolveGuestRole).
  // Per board: its label (#158) may keep visitors out.
  return boards.map((b) => ({ ...b, publicLink: b.linkPasswordHash === null && resolveGuestRole(b, accessOf(b)) !== null }));
}

/** A board of THIS workspace (404 otherwise: the console reaches nothing elsewhere). */
async function boardOfWorkspace(workspaceId: string, boardId: string): Promise<Board> {
  const board = await repo.getBoard(boardId);
  if (!board || board.workspaceId !== workspaceId) throw notFound('Board not found in this workspace');
  return board;
}

/** A content admin turns a board's link off from the inventory (#152): audited, link visitors disconnected. */
export async function turnOffLinkForWorkspace(workspaceId: string, boardId: string, actorId: string): Promise<void> {
  const board = await boardOfWorkspace(workspaceId, boardId);
  if (board.storedLinkAccess === 'none') return;
  await repo.updateBoardFields(board.id, { linkAccess: 'none' }, Date.now());
  await recordAudit({
    action: 'board.link_sharing_changed',
    workspaceId,
    actorId,
    target: boardTarget(board),
    metadata: { from: board.storedLinkAccess, to: 'none', by: 'admin' },
  });
  await refreshBoardAccess(board.id);
}

/** A content admin hands a board of the workspace to one of its members (#152; transferBoard's rules and audit). */
export async function transferForWorkspace(workspaceId: string, boardId: string, actorId: string, targetId: unknown): Promise<void> {
  await transferBoard(await boardOfWorkspace(workspaceId, boardId), actorId, targetId);
}

/** The board of this workspace, for another module's admin action (members: removing outsiders). */
export async function workspaceBoard(workspaceId: string, boardId: string): Promise<{ id: string; title: string; kind: ObjectKind }> {
  const b = await boardOfWorkspace(workspaceId, boardId);
  return { id: b.id, title: b.title, kind: b.kind };
}

// ---- archive and the workspace's trash (#153) ----

/**
 * Archives (or unarchives) a board: its owner or a content admin of its workspace. Archived, it is
 * read-only for everyone (resolveRole caps every role at 'viewer'), out of the default lists, and
 * no retention rule moves it to the trash. Live sockets are re-checked at once, on every instance.
 */
export async function setBoardArchived(boardId: string, userId: string, archived: boolean, now = Date.now()): Promise<Board> {
  const { board, access } = await requireAccess(boardId, userId, 'viewer');
  if (!mayArchive(board, userId, access)) throw forbidden('Only the board’s owner or a content admin of its workspace can archive it');
  const changed = await repo.transaction(async () => {
    if (!(await repo.setArchived(board.id, archived ? now : null, userId))) return false;
    await recordAudit({
      action: archived ? 'board.archived' : 'board.unarchived',
      workspaceId: board.workspaceId,
      actorId: userId,
      target: boardTarget(board),
      metadata: { owner: board.ownerId },
    });
    return true;
  });
  if (changed) await refreshBoardAccess(board.id);
  return { ...board, archivedAt: archived ? (changed ? now : board.archivedAt) : null, archivedBy: archived ? userId : null };
}

/**
 * #158: gives the board a classification label (null: none) — whoever manages its sharing (owner,
 * co-owner) or a content admin of its workspace. The label must be one boards there may carry; a
 * workspace that requires one refuses none. Its caps apply from the next request on, and everyone
 * connected is re-checked on every instance (a link the label caps lowers their role at once).
 */
export async function setBoardLabel(boardId: string, userId: string, labelId: unknown): Promise<Board> {
  if (labelId !== null && (typeof labelId !== 'string' || !labelId)) throw badRequest('labelId must be a label id or null');
  const { board, role, access, coOwner } = await requireAccess(boardId, userId, 'viewer');
  if (!managesSharing(role, coOwner) && !isManager(access.workspaceRole)) throw forbidden('Only the board’s owner, a co-owner or a content admin can change its label');
  if (labelId === board.labelId) return board;
  const [available, requirement] = await Promise.all([labelsAvailableIn(board.workspaceId), labelRequirement(board.workspaceId)]);
  const label = labelId ? available.find((l) => l.id === labelId) : null;
  if (labelId && !label) throw badRequest('That label isn’t available in this board’s workspace');
  if (!labelId && requirement.required) throw new HttpError(400, 'Boards in this workspace must carry a label', 'label_required');
  // A workspace policy may refuse it (the sensitive-data scan: a board holding findings keeps a label at least as strict as the one it requires).
  await checkLabelChange({ boardId: board.id, workspaceId: board.workspaceId, fromLabelId: board.labelId, toLabelId: (labelId as string | null) ?? null });
  await repo.transaction(async () => {
    if (!(await repo.setLabel(board.id, labelId as string | null))) throw notFound('Board not found');
    await recordAudit({
      action: 'board.label_changed',
      workspaceId: board.workspaceId,
      actorId: userId,
      target: boardTarget(board),
      metadata: { from: access.label?.name ?? null, fromId: board.labelId, to: label?.name ?? null, toId: (labelId as string | null) ?? null },
    });
  });
  await refreshBoardAccess(board.id);
  return { ...board, labelId: labelId as string | null };
}

/** The workspace's trash as its content admins see it (#153; the caller checked the scope): metadata only. */
export async function workspaceTrash(workspaceId: string): Promise<AdminTrashedBoard[]> {
  const boards = await repo.trashedInWorkspace(workspaceId);
  const [people, access] = await Promise.all([
    getUsers([...boards.map((b) => b.ownerId), ...boards.flatMap((b) => (b.deletedBy ? [b.deletedBy] : []))]),
    boardAccess('', { workspaceId, projectId: null }),
  ]);
  return boards.map((b) => ({
    boardId: b.id,
    kind: b.kind,
    title: b.title,
    ownerId: b.ownerId,
    ownerName: people.get(b.ownerId)?.name ?? 'Deleted user',
    deletedBy: b.deletedBy ? { id: b.deletedBy, name: people.get(b.deletedBy)?.name ?? 'Deleted user' } : null,
    deletedAt: b.deletedAt!,
    purgeAt: b.deletedAt! + access.trashRetentionDays * DAY_MS,
  }));
}

/**
 * A content admin restores any board of the workspace's trash (#153; the caller checked the scope),
 * for its owner: it counts against the OWNER's board quota, and is audited with who restored it.
 * 404 for a board that isn't in THIS workspace's trash (another workspace's, taken down, gone).
 */
export async function restoreForWorkspace(workspaceId: string, boardId: string, actorId: string, now = Date.now()): Promise<void> {
  const board = await repo.getBoardIncludingTrash(boardId);
  if (!board || board.workspaceId !== workspaceId || board.deletedAt === null || board.removedAt !== null) throw notFound('Board not found in this workspace’s trash');
  await withinBoardQuota(
    board.ownerId,
    (max) => `Its owner has reached the limit of ${max} boards. They need to delete boards before this one can be restored.`,
    async () => {
      if (!(await repo.restoreBoard(board.id, now))) throw notFound('Board not found in this workspace’s trash');
      await recordAudit({
        action: 'board.restored',
        workspaceId,
        actorId,
        target: boardTarget(board),
        metadata: { owner: board.ownerId, by: 'admin', deletedBy: board.deletedBy },
      });
      await repo.appendBoardEvent({ type: 'board.restored', boardId: board.id, workspaceId, actorId, title: board.title });
    },
  );
  await boardLifecycle({ boardId: board.id, actorId, action: 'restored' });
}

/** Owner only: deletes a trashed board and everything on it for good. */
export async function deleteForever(boardId: string, userId: string): Promise<void> {
  const board = await repo.getBoardIncludingTrash(boardId);
  if (!board || board.deletedAt === null || board.ownerId !== userId || board.removedAt !== null) throw notFound('Board not found in your trash');
  // Under a legal hold (#157) it only looks deleted: it leaves the trash for everyone and is kept
  // for the case, then purged once no hold is left. The hold stays silent to its owner.
  let deleted: { thumbnail: string | null } | null = null;
  if (!(await repo.heldAmong([board.id])).has(board.id)) {
    try {
      deleted = await repo.transaction(async () => {
        const thumbnail = await repo.deleteTrashedBoard(board.id);
        if (thumbnail === undefined) throw notFound('Board not found in your trash'); // restored or purged meanwhile
        await recordAudit({ action: 'board.deleted', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board) });
        return { thumbnail };
      });
    } catch (e) {
      // A hold placed since the check: the database refused the delete (and rolled it back). It is
      // kept exactly as if the hold had been there first, just as silently.
      if (!repo.isLegalHoldViolation(e)) throw e;
    }
  }
  if (!deleted)
    await repo.transaction(async () => {
      if (!(await repo.discardTrashedBoard(board.id, Date.now()))) throw notFound('Board not found in your trash');
      await recordAudit({ action: 'board.deleted', workspaceId: board.workspaceId, actorId: userId, target: boardTarget(board), metadata: { keptBy: 'legal_hold' } });
    });
  await closeBoardDoc(board.id); // nobody should be connected; make sure nothing saves after the delete
  if (deleted) await deleteUpload(deleted.thumbnail);
}

const PURGE_BATCH = 200;

/** Advisory lock key of the trash purge (platform/jobs). */
export const TRASH_PURGE_LOCK_KEY = 7_202_610_282; // arbitrary, constant across releases

/**
 * Deletes for good every board that has been in the trash longer than its workspace's trash
 * retention (TRASH_RETENTION_DAYS unless the workspace sets its own). Idempotent and safe to run on
 * every server instance at once: one instance purges (advisory lock), the others skip this round
 * (0). Returns how many boards this call removed.
 */
export async function purgeExpiredTrash(now = Date.now()): Promise<number> {
  return (await runExclusive(TRASH_PURGE_LOCK_KEY, () => purgeExpiredTrashLocked(now))) ?? 0;
}

/** The purge itself; the caller holds TRASH_PURGE_LOCK_KEY (purgeExpiredTrash or the scheduled job). */
export async function purgeExpiredTrashLocked(now = Date.now()): Promise<number> {
  const before = now - TRASH_RETENTION_MS;
  const byWorkspace = (await retentionOverrides())
    .filter((o) => o.trashDays !== TRASH_RETENTION_DAYS)
    .map((o) => ({ workspaceId: o.id, before: now - o.trashDays * DAY_MS }));
  // Held boards whose time is up leave the trash as if purged, and are kept (#157).
  await repo.discardHeldExpired(before, byWorkspace, now);
  let total = 0;
  for (;;) {
    const purged = await repo.transaction(async () => {
      const rows = await repo.purgeTrashedBefore(before, PURGE_BATCH, byWorkspace);
      for (const b of rows)
        await recordAudit({
          action: 'board.purged',
          workspaceId: b.workspaceId,
          actorId: null,
          target: { type: 'board', id: b.id, label: b.title },
          metadata: { owner: b.ownerId, trashedAt: new Date(b.deletedAt).toISOString(), ...(b.discarded ? { reason: 'legal_hold_released' } : {}) },
        });
      return rows;
    });
    for (const b of purged) {
      await closeBoardDoc(b.id);
      await deleteUpload(b.thumbnail);
    }
    total += purged.length;
    if (purged.length < PURGE_BATCH) break;
  }
  return total;
}

/**
 * Changes a board's title and / or description as `actorId` (the caller checked they may: an owner
 * or editor): one write, and a rename is the `board.renamed` event (outbox, same transaction) and
 * the activity feed's lifecycle entry, like the board menu's rename.
 */
export async function renameBoard(board: Board, actorId: string, patch: { title?: string; description?: string }): Promise<void> {
  if (patch.title === undefined && patch.description === undefined) return;
  const renamed = patch.title !== undefined && patch.title !== board.title;
  await repo.transaction(async () => {
    await repo.updateBoardFields(board.id, patch, Date.now());
    if (renamed) await repo.appendBoardEvent({ type: 'board.renamed', boardId: board.id, workspaceId: board.workspaceId, actorId, title: patch.title!, from: board.title, to: patch.title! });
  });
  if (renamed) await boardLifecycle({ boardId: board.id, actorId, action: 'renamed', from: board.title, to: patch.title });
}

/**
 * A copy of `source` owned by `userId`, with the source's current content: where they chose
 * (`where`, #124: a workspace and project they may create boards in — createBoard checks), else in
 * the same workspace and project when the user may create boards there, else in their personal
 * workspace. The new board row and its content are written in one transaction: if saving the
 * content fails there is no empty copy. Hidden frames' contents (the 'editors' layer) are copied
 * only for someone who may see them (`role` owner/editor); nobody's private layer (drafts, sealed
 * ballots) is ever copied.
 */
export async function duplicateBoard(source: Board, userId: string, role: Role, where: { workspaceId?: unknown; projectId?: unknown } = {}): Promise<Board> {
  let place: BoardPlace;
  if (where.workspaceId !== undefined && where.workspaceId !== null) {
    if (typeof where.workspaceId !== 'string' || !where.workspaceId) throw badRequest('workspaceId must be a workspace id');
    if (where.projectId !== undefined && where.projectId !== null && typeof where.projectId !== 'string') throw badRequest('projectId must be a project id or null');
    place = { workspaceId: where.workspaceId, projectId: (where.projectId as string | null | undefined) || null };
  } else {
    const wsRole = await workspaceRole(source.workspaceId, userId);
    place = isFullMember(wsRole) ? { workspaceId: source.workspaceId, projectId: source.projectId } : {};
  }
  // A copy keeps its source's label (#158), and can't land where that label doesn't apply.
  if (source.labelId) {
    const target = place.workspaceId || (await ensurePersonalWorkspace(userId));
    place = { ...place, workspaceId: target, labelId: await labelInTarget((await boardAccess(userId, source)).label, target) };
  }
  // Read the content BEFORE the transaction: it may wait for the live doc to finish loading,
  // which queries the database outside this transaction.
  const state = await snapshotBoardDoc(source.id);
  // Pending suggestions stay with the board they were proposed for (KAI-169).
  const editors = atLeast(role, 'editor') ? await snapshotBoardLayer(source.id, 'editors', { withoutSuggestions: true }) : null;
  const made = await repo.transaction(async () => {
    const copy = await createBoard(userId, `Copy of ${source.title}`.slice(0, 200), source.description, 'none', place, source.id, source.kind);
    await recordAudit({
      action: 'board.duplicated',
      workspaceId: source.workspaceId,
      actorId: userId,
      target: boardTarget(source),
      metadata: { copy: copy.id, copyWorkspace: copy.workspaceId },
    });
    if (state) await initBoardDoc(copy.id, state);
    if (editors) await initBoardLayer(copy.id, 'editors', editors);
    return copy;
  });
  await boardLifecycle({ boardId: made.id, actorId: userId, action: 'duplicated', from: source.title, sourceId: source.id, sourceRole: role });
  return made;
}

/**
 * A new board for `userId` made from a backup (KAI-137): the board row and its content in ONE
 * transaction (a failure leaves no empty board), in the workspace / project they chose — where
 * they may create boards, under their board quota. `state` / `editors` are document states built
 * by realtime from the file's content (already remapped to fresh ids and re-uploaded files).
 */
export async function restoreBoard(
  userId: string,
  fields: { title: string; description: string; place: BoardPlace },
  content: { state: Uint8Array; editors: Uint8Array | null },
  source: { boardId: string; title: string; origin: string | null; formatVersion: number; files: number; missingFiles: number },
): Promise<Board> {
  const made = await repo.transaction(async () => {
    const board = await createBoard(userId, cleanTitle(fields.title), cleanDescription(fields.description), 'none', fields.place);
    await recordAudit({
      action: 'board.backup_restored',
      workspaceId: board.workspaceId,
      actorId: userId,
      target: boardTarget(board),
      metadata: {
        sourceBoard: source.boardId,
        sourceTitle: source.title,
        sourceOrigin: source.origin,
        formatVersion: source.formatVersion,
        files: source.files,
        missingFiles: source.missingFiles,
        hiddenContent: content.editors !== null,
      },
    });
    await initBoardDoc(board.id, content.state);
    if (content.editors) await initBoardLayer(board.id, 'editors', content.editors);
    return board;
  });
  await boardLifecycle({ boardId: made.id, actorId: userId, action: 'created' });
  return made;
}

// ---- workspaces (called by modules/workspaces through index.ts) ----

/** Deletes every board of a workspace (inside the caller's transaction); then call cleanUpDeletedBoards. */
export function deleteBoardRowsInWorkspace(workspaceId: string): Promise<Array<{ id: string; thumbnail: string | null }>> {
  return repo.deleteAllInWorkspace(workspaceId);
}

/** After board rows were deleted: disconnect everyone, make sure nothing saves after, delete thumbnails. */
export async function cleanUpDeletedBoards(gone: Array<{ id: string; thumbnail: string | null }>): Promise<void> {
  for (const b of gone) {
    await closeBoardDoc(b.id);
    await deleteUpload(b.thumbnail);
  }
}
