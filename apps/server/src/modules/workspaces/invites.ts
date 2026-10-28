// Inviting people into a team workspace by email — the same flow as board invites (members/invites):
// an existing account joins at once; any other address gets a pending invite with an emailed
// single-use link /workspace-invite/<token> (256-bit random, only its sha256 stored), which is
// accepted after signing up, or converted when the address is verified another way.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { User, WorkspaceInvite, WorkspaceInvitePreview, WorkspaceMember } from '@freero/shared';
import { badRequest, forbidden, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { findUserByEmail, getUser, getUsers, markEmailVerified, normalizeEmail } from '../auth/index';
import { recordAudit } from '../audit/index';
import { notify } from '../notifications/index';
import * as repo from './repo';
import { isInvitableWorkspaceRole, mayInvite, type InvitableWorkspaceRole } from './roles';
import { memberOf, refreshWorkspaceBoards, requireWorkspace } from './service';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const ROLE_PHRASE: Record<InvitableWorkspaceRole, string> = {
  admin: 'as an admin',
  member: 'as a member',
  guest: 'as a guest (you’ll see the boards shared with you)',
};

const toInvite = (i: repo.InviteRow, inviterName: string): WorkspaceInvite => ({
  id: i.id,
  email: i.email,
  role: i.role,
  invitedById: i.invitedBy,
  invitedByName: inviterName,
  createdAt: i.createdAt,
  expiresAt: i.expiresAt,
});

export async function listInvites(workspaceId: string, userId: string): Promise<WorkspaceInvite[]> {
  await requireWorkspace(workspaceId, userId, 'member');
  const rows = await repo.listInvites(workspaceId);
  const users = await getUsers(rows.map((r) => r.invitedBy));
  return rows.map((r) => toInvite(r, users.get(r.invitedBy)?.name ?? 'Someone'));
}

async function sendInviteMail(req: Request | null, to: string, token: string, workspaceName: string, inviter: User, role: InvitableWorkspaceRole) {
  try {
    await sendMail({
      to,
      ...renderMail({
        subject: `${inviter.name} invited you to the “${workspaceName}” workspace on Freero`,
        title: `Join “${workspaceName}” on Freero`,
        paragraphs: [`${inviter.name} invited you to join their team workspace ${ROLE_PHRASE[role]}. Freero is a free online whiteboard; you'll need a free account.`],
        action: { label: 'Join the workspace', url: appUrl(req, `/workspace-invite/${token}`) },
        outro: `${inviter.name} (${inviter.email}) sent this invite. The link works once and expires in 14 days.`,
      }),
    });
  } catch (e) {
    logError('workspaces: could not send an invite email', e); // the members page can resend it
  }
}

/** POST /workspaces/:id/members: adds an existing account at once, else emails a pending invite. */
export async function inviteToWorkspace(
  req: Request | null,
  workspaceId: string,
  inviter: User & { emailVerified: boolean },
  body: { email?: unknown; role?: unknown },
): Promise<{ member: WorkspaceMember } | { invite: WorkspaceInvite }> {
  const email = normalizeEmail(body.email);
  if (!email || !EMAIL_RE.test(email) || email.length > 254) throw badRequest('Enter a valid email address');
  if (!isInvitableWorkspaceRole(body.role)) throw badRequest('role must be admin, member or guest');
  const role = body.role;
  const { workspace, role: mine } = await requireWorkspace(workspaceId, inviter.id);
  if (workspace.kind !== 'team') throw badRequest('Invite people to a team workspace, not your personal one');
  if (!mayInvite(mine, role, workspace.policies))
    throw forbidden(
      role === 'guest' ? 'Only workspace owners and admins can invite guests here' : mine === 'admin' ? 'Only a workspace owner can add admins' : 'Only workspace owners and admins can invite members',
    );
  if (!inviter.emailVerified) throw forbidden('Verify your email address before inviting people');

  const invitee = await findUserByEmail(email);
  if (invitee) {
    const now = await repo.addMemberIfAbsent(workspaceId, invitee.id, role, Date.now());
    if (now === null) throw notFound('Workspace not found');
    if (now !== role) throw new HttpError(409, `${invitee.name} is already in this workspace (${now}). Change their role instead.`);
    await recordAudit({ action: 'member.invited', workspaceId, actorId: inviter.id, target: { type: 'user', id: invitee.id, label: email }, metadata: { role, added: true } });
    await refreshWorkspaceBoards(workspaceId); // they may have had some of its boards open
    // In their bell (and email digest, per their settings): an existing account joins without a link.
    await notify({
      userId: invitee.id,
      type: 'workspace.invite',
      actorId: inviter.id,
      boardId: null,
      data: { workspaceId, workspaceName: workspace.name, role },
      dedupeKey: `workspace-invite:${workspaceId}:${invitee.id}`, // re-inviting a member does not ping them again
    }).catch((e) => logError('workspaces: could not notify an invitee', e));
    return { member: (await memberOf(workspaceId, invitee.id))! };
  }
  const token = randomBytes(32).toString('base64url');
  const at = Date.now();
  const saved = await repo.saveInvite({
    id: newId(16),
    workspaceId,
    email,
    role,
    tokenHash: hash(token),
    invitedBy: inviter.id,
    now: at,
    expiresAt: at + INVITE_TTL_MS,
  });
  if (!saved) throw notFound('Workspace not found');
  await recordAudit({ action: 'member.invited', workspaceId, actorId: inviter.id, target: { type: 'email', id: email, label: email }, metadata: { role, added: false } });
  await sendInviteMail(req, email, token, workspace.name, inviter, role);
  return { invite: toInvite(saved, inviter.name) };
}

export async function resendInvite(req: Request | null, workspaceId: string, inviteId: string, by: User & { emailVerified: boolean }): Promise<WorkspaceInvite> {
  const { workspace } = await requireWorkspace(workspaceId, by.id, 'admin');
  if (!by.emailVerified) throw forbidden('Verify your email address before inviting people');
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const row = await repo.renewInvite(workspaceId, inviteId, hash(token), now, now + INVITE_TTL_MS);
  if (!row) throw notFound('That invite was already used or revoked');
  await sendInviteMail(req, row.email, token, workspace.name, by, row.role);
  return toInvite(row, (await getUser(row.invitedBy))?.name ?? by.name);
}

export async function revokeInvite(workspaceId: string, inviteId: string, userId: string): Promise<void> {
  await requireWorkspace(workspaceId, userId, 'admin');
  const invite = (await repo.listInvites(workspaceId)).find((i) => i.id === inviteId);
  if (!(await repo.deleteInvite(workspaceId, inviteId))) throw notFound('No such pending invite');
  await recordAudit({ action: 'member.invite_revoked', workspaceId, actorId: userId, target: { type: 'email', id: invite?.email ?? inviteId, label: invite?.email ?? null }, metadata: { role: invite?.role ?? null } });
}

const deadLink = () => notFound('This invite link is no longer valid. Ask for a new invite.');

export async function previewInvite(token: string): Promise<WorkspaceInvitePreview> {
  const row = token ? await repo.findLiveInvite(hash(token), Date.now()) : null;
  const ws = row ? await repo.getWorkspace(row.workspaceId) : null;
  if (!row || !ws) throw deadLink();
  const inviter = await getUser(row.invitedBy);
  return { workspaceName: ws.name, inviterName: inviter?.name ?? 'Someone', email: row.email, role: row.role, expiresAt: row.expiresAt };
}

/** Uses the invite for the signed-in user (single use). */
export async function acceptInvite(token: string, user: { id: string; email: string }): Promise<{ workspaceId: string }> {
  const row = token ? await repo.takeInvite(hash(token), Date.now()) : null;
  if (!row) throw deadLink();
  if (!(await repo.grantAtLeast(row.workspaceId, user.id, row.role, Date.now()))) throw deadLink();
  await recordAudit({ action: 'member.joined', workspaceId: row.workspaceId, actorId: user.id, target: { type: 'user', id: user.id, label: user.email }, metadata: { role: row.role, via: 'invite_link', invitedBy: row.invitedBy } });
  await refreshWorkspaceBoards(row.workspaceId);
  // The link was mailed to that address: following it proves the address.
  if (row.email === user.email) await markEmailVerified(user.id, user.email);
  return { workspaceId: row.workspaceId };
}

/** The user proved `email`: every live workspace invite sent to it becomes a membership. */
export async function convertInvitesFor(user: { id: string; email: string }): Promise<void> {
  for (const row of await repo.takeInvitesForEmail(user.email, Date.now())) {
    if (!(await repo.grantAtLeast(row.workspaceId, user.id, row.role, Date.now()))) continue;
    await recordAudit({ action: 'member.joined', workspaceId: row.workspaceId, actorId: user.id, target: { type: 'user', id: user.id, label: user.email }, metadata: { role: row.role, via: 'verified_email', invitedBy: row.invitedBy } });
    await refreshWorkspaceBoards(row.workspaceId);
  }
}
