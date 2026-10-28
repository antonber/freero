// Sharing a board with people: the rules behind GET/POST/PATCH/DELETE /boards/:id/members, used by
// this module's routes and by the public API (modules/api), so both enforce exactly the same.
import type { Request } from 'express';
import type { Account, BoardMember, InviteResponse, Role, User } from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { recordAuditQuietly } from '../audit/index';
import { findUserByEmail, getUser, getUsers, normalizeEmail } from '../auth/index';
import { requireBoardAccess, teamAccessMembers } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import { boardShared } from './events';
import { inviteByEmail } from './invites';
import * as repo from './repo';
import { atLeast, isMemberRole } from './roles';

/**
 * Emails are only shown to people who can manage sharing (owner, editors): anyone with a "can
 * view" link would otherwise harvest every collaborator's address.
 */
export const toMember = (u: User, role: Role, withEmail: boolean): BoardMember => ({
  userId: u.id,
  name: u.name,
  ...(withEmail ? { email: u.email } : {}),
  color: u.color,
  avatarUrl: u.avatarUrl,
  role,
});

const boardGone = () => notFound('Board not found');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Everyone with access: the owner, invited members, then people the team gives access. */
export async function listBoardMembers(boardId: string, meId: string): Promise<BoardMember[]> {
  const { ownerId, role: myRole } = await requireBoardAccess(boardId, meId);
  const emails = atLeast(myRole, 'editor');
  const [rows, team] = await Promise.all([repo.listByBoard(boardId), teamAccessMembers(boardId)]);
  const listed = new Set([ownerId, ...rows.map((m) => m.userId)]);
  const viaTeam = team.filter((t) => !listed.has(t.userId));
  const users = await getUsers([...listed, ...viaTeam.map((t) => t.userId)]);
  const members: BoardMember[] = [];
  const owner = users.get(ownerId);
  if (owner) members.push(toMember(owner, 'owner', emails || owner.id === meId));
  for (const m of rows) {
    const u = users.get(m.userId);
    if (u) members.push(toMember(u, m.role, emails || u.id === meId));
  }
  // Team access (the role the workspace grants each of them here; see workspaces/roles.ts).
  for (const t of viaTeam) {
    const u = users.get(t.userId);
    if (u) members.push({ ...toMember(u, t.role, emails || u.id === meId), team: true });
  }
  return members;
}

/** Shares the board with an address (owner/editor with a verified email). `req` builds the emailed link. */
export async function inviteBoardMember(req: Request | null, boardId: string, me: Account, body: { email?: unknown; role?: unknown }): Promise<InviteResponse> {
  const { ownerId, role: myRole, title, canShareExternally, inWorkspace, workspaceId } = await requireBoardAccess(boardId, me.id, 'editor');
  const board = { type: 'board', id: boardId, label: title };
  const email = normalizeEmail(body.email);
  const role = body.role;
  if (!email) throw badRequest('email is required');
  if (!EMAIL_RE.test(email) || email.length > 254) throw badRequest('Enter a valid email address');
  if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
  // Otherwise anyone could sign up with a made-up address and mail invites in its name.
  if (!me.emailVerified) throw forbidden('Verify your email address before inviting people');
  const invitee = await findUserByEmail(email);
  // Workspace policy "external sharing": people outside the board's workspace (an address
  // without an account always is) need someone allowed to share outside it.
  if (!canShareExternally && !(invitee && (await inWorkspace(invitee.id))))
    throw forbidden('This workspace only lets you share its boards with people in it');
  if (!invitee) {
    const out = await inviteByEmail(req, { boardId, boardTitle: title, email, role, inviter: me, mayChangeRole: myRole === 'owner' });
    if (out === 'board-gone') throw boardGone();
    if (out === 'role-conflict') throw new HttpError(409, `${email} is already invited. Only the board owner can change their role.`);
    await recordAuditQuietly({ action: 'board.member_invited', workspaceId, actorId: me.id, target: board, metadata: { email, role, pending: true } });
    return { invite: out };
  }
  if (invitee.id === ownerId) throw new HttpError(409, 'That person already owns this board');
  if (myRole === 'owner') {
    if (!(await repo.upsertMember(boardId, invitee.id, role, Date.now()))) throw boardGone();
  } else {
    // Re-inviting changes an existing member's role, which only the owner may do (PATCH is
    // owner-only too): editors could otherwise promote viewers or demote other editors.
    // One conditional insert, so a concurrent role change cannot slip between check and write.
    const now = await repo.addMemberIfAbsent(boardId, invitee.id, role, Date.now());
    if (now === null) throw boardGone();
    if (now !== role) throw new HttpError(409, `${invitee.name} already has access. Only the board owner can change their role.`);
  }
  await refreshBoardAccess(boardId);
  await recordAuditQuietly({ action: 'board.member_invited', workspaceId, actorId: me.id, target: board, metadata: { email, userId: invitee.id, role, pending: false } });
  await boardShared({ boardId, boardTitle: title, userId: invitee.id, role, byId: me.id });
  return { member: toMember(invitee, role, true) };
}

/** Changes a member's role (owner only). */
export async function setBoardMemberRole(boardId: string, meId: string, userId: string, role: unknown): Promise<BoardMember> {
  const { workspaceId, title } = await requireBoardAccess(boardId, meId, 'owner');
  if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
  const u = await getUser(userId);
  const before = await repo.getMembership(boardId, userId);
  if (!u || !(await repo.setRole(boardId, userId, role))) throw notFound('That person is not a member of this board');
  await recordAuditQuietly({
    action: 'board.member_role_changed',
    actorId: meId,
    workspaceId,
    target: { type: 'board', id: boardId, label: title },
    metadata: { userId, email: u.email, from: before?.role ?? null, to: role },
  });
  await refreshBoardAccess(boardId);
  return toMember(u, role, true);
}

/** Removes a member (the owner; or the member themselves, leaving). Cuts their live access at once. */
export async function removeBoardMember(boardId: string, meId: string, userId: string): Promise<void> {
  const { role, workspaceId, title } = await requireBoardAccess(boardId, meId);
  if (role !== 'owner' && userId !== meId) throw forbidden('Only the board owner can remove members');
  if (!(await repo.removeMember(boardId, userId))) throw notFound('That person is not a member of this board');
  await recordAuditQuietly({ action: 'board.member_removed', workspaceId, actorId: meId, target: { type: 'board', id: boardId, label: title }, metadata: { userId, left: userId === meId } });
  await refreshBoardAccess(boardId);
}
