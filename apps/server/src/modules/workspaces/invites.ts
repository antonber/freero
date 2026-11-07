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
import { findUserByEmail, getUser, getUsers, localeOfEmail, localesOf, markEmailVerified, normalizeEmail } from '../auth/index';
import { recordAudit } from '../audit/index';
import { notify } from '../notifications/index';
import { t } from './messages';
import * as repo from './repo';
import { INVITABLE_WORKSPACE_ROLES, invitingRole, isInvitableWorkspaceRole, mayInvite, type InvitableWorkspaceRole } from './roles';
import { memberOf, refreshWorkspaceBoards, requireWorkspace } from './service';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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
    // The invitee's language if the address has an account, else the inviter's (#5).
    const locale = (await localeOfEmail(to)) ?? (await localesOf([inviter.id])).get(inviter.id) ?? null;
    const vars = { inviter: inviter.name, workspace: workspaceName, email: inviter.email, role };
    await sendMail({
      to,
      ...renderMail({
        locale,
        subject: t(locale, 'invite.subject', vars),
        title: t(locale, 'invite.title', vars),
        paragraphs: [t(locale, 'invite.body', vars)],
        action: { label: t(locale, 'invite.action'), url: appUrl(req, `/workspace-invite/${token}`) },
        outro: t(locale, 'invite.outro', vars),
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
  const invitee = await findUserByEmail(email);
  const token = randomBytes(32).toString('base64url');
  // The inviter is authorised under the workspace's lock, against their membership as it is now
  // (not as it was before a concurrent removal, demotion or deactivation committed).
  const { workspace, saved } = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'share'))) throw notFound('Workspace not found');
    const { workspace, role: asStored, scopes } = await requireWorkspace(workspaceId, inviter.id);
    const mine = invitingRole(asStored, scopes);
    if (workspace.kind !== 'team') throw badRequest('Invite people to a team workspace, not your personal one');
    if (!mayInvite(mine, role, workspace.policies))
      throw forbidden(
        role === 'guest' ? 'Only workspace owners and admins can invite guests here' : mine === 'admin' ? 'Only a workspace owner can add admins' : 'Only workspace owners and admins can invite members',
      );
    if (!inviter.emailVerified) throw forbidden('Verify your email address before inviting people');
    if (invitee) {
      const now = await repo.addMemberIfAbsent(workspaceId, invitee.id, role, Date.now());
      if (now === null) throw notFound('Workspace not found');
      if (now !== role) throw new HttpError(409, `${invitee.name} is already in this workspace (${now}). Change their role instead.`);
      await recordAudit({ action: 'member.invited', workspaceId, actorId: inviter.id, target: { type: 'user', id: invitee.id, label: email }, metadata: { role, added: true } });
      return { workspace, saved: null };
    }
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
    return { workspace, saved };
  });

  if (invitee) {
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
  await sendInviteMail(req, email, token, workspace.name, inviter, role);
  return { invite: toInvite(saved!, inviter.name) };
}

/**
 * Sends a pending invite again with a fresh link, in the name of whoever resends it. They take it
 * over when they may invite at its role themselves, so an invite whose inviter can no longer send it
 * (see `inviterStillVouches`) works again once someone who may resends it.
 */
export async function resendInvite(req: Request | null, workspaceId: string, inviteId: string, by: User & { emailVerified: boolean }): Promise<WorkspaceInvite> {
  const token = randomBytes(32).toString('base64url');
  const { workspace, row } = await repo.transaction(async () => {
    if (!(await repo.lockWorkspace(workspaceId, 'share'))) throw notFound('Workspace not found');
    const { workspace, role, scopes } = await requireWorkspace(workspaceId, by.id, 'admin', { scope: 'members' });
    if (!by.emailVerified) throw forbidden('Verify your email address before inviting people');
    const mine = invitingRole(role, scopes);
    const roles = INVITABLE_WORKSPACE_ROLES.filter((r) => mayInvite(mine, r, workspace.policies));
    const now = Date.now();
    const row = await repo.renewInvite(workspaceId, inviteId, hash(token), now, now + INVITE_TTL_MS, { id: by.id, roles });
    if (!row) throw notFound('That invite was already used or revoked');
    return { workspace, row };
  });
  await sendInviteMail(req, row.email, token, workspace.name, by, row.role);
  return toInvite(row, (await getUser(row.invitedBy))?.name ?? by.name);
}

/**
 * May the person who sent this invite still send it? An invite carries its inviter's authority:
 * it opens the workspace only while they are an active member who may invite at its role (their
 * role, admin scopes and the guest-invite policy as they are now). So removing, deactivating or
 * demoting an inviter ends what they sent, and reactivating them before it expires restores it.
 * Checked where an invite is used (under the workspace's lock), previewed and counted for sign-up.
 */
async function inviterStillVouches(row: repo.InviteRow): Promise<boolean> {
  const [workspace, inviter] = await Promise.all([repo.getWorkspace(row.workspaceId), repo.getMember(row.workspaceId, row.invitedBy)]);
  if (!workspace || workspace.kind !== 'team' || !inviter || inviter.deactivatedAt !== null) return false;
  return mayInvite(invitingRole(inviter.role, inviter.adminScopes), row.role, workspace.policies);
}

/**
 * Uses one live invite for `user` (single use: of two concurrent uses one gets it), under the
 * workspace's lock and only while its inviter still vouches for it; `tokenHash`: the link it was
 * opened with (null: the address was proved). False when it can't be used: the invite is then left
 * as it was. Refreshes the workspace's boards when it granted something.
 */
async function useInvite(row: repo.InviteRow, user: { id: string; email: string }, tokenHash: string | null): Promise<boolean> {
  const used = await repo
    .transaction(async () => {
      if (!(await repo.lockWorkspace(row.workspaceId, 'share'))) return false;
      const taken = await repo.takeInvite(row.id, Date.now(), tokenHash);
      if (!taken) return false;
      // Unusable: rolled back, so the invite stays (it works again if its inviter regains the right).
      if (!(await inviterStillVouches(taken)) || !(await repo.grantAtLeast(taken.workspaceId, user.id, taken.role, Date.now()))) throw UNUSABLE;
      const via = tokenHash ? 'invite_link' : 'verified_email';
      await recordAudit({ action: 'member.joined', workspaceId: taken.workspaceId, actorId: user.id, target: { type: 'user', id: user.id, label: user.email }, metadata: { role: taken.role, via, invitedBy: taken.invitedBy } });
      return true;
    })
    .catch((e: unknown) => {
      if (e === UNUSABLE) return false;
      throw e;
    });
  if (used) await refreshWorkspaceBoards(row.workspaceId);
  return used;
}
const UNUSABLE = Symbol('unusable invite');

/** Whether a live invite someone may still send was sent to `email` (an invite-only server lets that address sign up). */
export async function hasUsableInviteFor(email: string): Promise<boolean> {
  for (const row of await repo.liveInvitesFor(email, Date.now())) if (await inviterStillVouches(row)) return true;
  return false;
}

export async function revokeInvite(workspaceId: string, inviteId: string, userId: string): Promise<void> {
  await requireWorkspace(workspaceId, userId, 'admin', { scope: 'members' });
  const invite = (await repo.listInvites(workspaceId)).find((i) => i.id === inviteId);
  if (!(await repo.deleteInvite(workspaceId, inviteId))) throw notFound('No such pending invite');
  await recordAudit({ action: 'member.invite_revoked', workspaceId, actorId: userId, target: { type: 'email', id: invite?.email ?? inviteId, label: invite?.email ?? null }, metadata: { role: invite?.role ?? null } });
}

const deadLink = () => notFound('This invite link is no longer valid. Ask for a new invite.');

export async function previewInvite(token: string): Promise<WorkspaceInvitePreview> {
  const row = token ? await repo.findLiveInvite(hash(token), Date.now()) : null;
  const ws = row ? await repo.getWorkspace(row.workspaceId) : null;
  if (!row || !ws || !(await inviterStillVouches(row))) throw deadLink();
  const inviter = await getUser(row.invitedBy);
  return { workspaceName: ws.name, inviterName: inviter?.name ?? 'Someone', email: row.email, role: row.role, expiresAt: row.expiresAt };
}

/** Uses the invite for the signed-in user (single use). */
export async function acceptInvite(token: string, user: { id: string; email: string }): Promise<{ workspaceId: string }> {
  const row = token ? await repo.findLiveInvite(hash(token), Date.now()) : null;
  if (!row || !(await useInvite(row, user, hash(token)))) throw deadLink();
  // The link was mailed to that address: following it proves the address.
  if (row.email === user.email) await markEmailVerified(user.id, user.email);
  return { workspaceId: row.workspaceId };
}

/** The user proved `email`: every live workspace invite sent to it, that its inviter may still send, becomes a membership. */
export async function convertInvitesFor(user: { id: string; email: string }): Promise<void> {
  for (const row of await repo.liveInvitesFor(user.email, Date.now())) await useInvite(row, user, null);
}
