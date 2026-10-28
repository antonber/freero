// Pending invites: sharing a board with an address that has no Freero account yet.
//
// The invitee gets an emailed link /invite/<token> (256-bit random; only its sha256 is stored).
// Opening it while signed in — or after signing up / logging in from it — accepts it: the invite
// row is deleted and becomes a membership (single use; expired or revoked invites grant nothing).
// Proving the address another way (the verification link) converts every live invite sent to it.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { InvitePreview, PendingInvite, Role, User } from '@freero/shared';
import { notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { getUser, getUsers, markEmailVerified } from '../auth/index';
import { getBoardAccess, getBoardTitle } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import type { MemberRole } from './roles';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

const ROLE_PHRASE: Record<MemberRole, string> = { editor: 'edit', commenter: 'comment on', viewer: 'view' };

export function toPending(i: repo.InviteRow, inviterName: string): PendingInvite {
  return { id: i.id, email: i.email, role: i.role, invitedById: i.invitedBy, invitedByName: inviterName, createdAt: i.createdAt, expiresAt: i.expiresAt };
}

export async function listPending(boardId: string): Promise<PendingInvite[]> {
  const rows = await repo.listInvites(boardId);
  const users = await getUsers(rows.map((r) => r.invitedBy));
  return rows.map((r) => toPending(r, users.get(r.invitedBy)?.name ?? 'Someone'));
}

async function sendInviteMail(req: Request | null, to: string, token: string, boardTitle: string, inviter: User, role: MemberRole): Promise<void> {
  try {
    await sendMail({
      to,
      ...renderMail({
        subject: `${inviter.name} invited you to “${boardTitle}” on Freero`,
        title: `${inviter.name} invited you to a board`,
        paragraphs: [`You can ${ROLE_PHRASE[role]} “${boardTitle}”. Freero is a free online whiteboard; you'll need a free account to open it.`],
        action: { label: 'Open the board', url: appUrl(req, `/invite/${token}`) },
        outro: `${inviter.name} (${inviter.email}) sent this invite. The link works once and expires in 14 days.`,
      }),
    });
  } catch (e) {
    // The invite exists either way; the share dialog can resend it.
    logError('members: could not send an invite email', e);
  }
}

/**
 * Invites an address without an account (or renews its pending invite: new link, new expiry).
 * Returns null when an editor tried to change the role of an existing invite.
 */
export async function inviteByEmail(
  req: Request | null,
  a: { boardId: string; boardTitle: string; email: string; role: MemberRole; inviter: User; mayChangeRole: boolean },
): Promise<PendingInvite | 'role-conflict' | 'board-gone'> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const saved = await repo.saveInvite(
    { id: newId(16), boardId: a.boardId, email: a.email, role: a.role, tokenHash: hash(token), invitedBy: a.inviter.id, now, expiresAt: now + INVITE_TTL_MS },
    a.mayChangeRole,
  );
  if (typeof saved === 'string') return saved;
  await sendInviteMail(req, a.email, token, a.boardTitle, a.inviter, saved.role);
  return toPending(saved, a.inviter.name);
}

/** Sends a pending invite again with a fresh link (the old one stops working). */
export async function resendInvite(req: Request | null, boardId: string, boardTitle: string, inviteId: string, by: User): Promise<PendingInvite> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const row = await repo.renewInvite(boardId, inviteId, hash(token), now, now + INVITE_TTL_MS);
  if (!row) throw notFound('That invite was already used or revoked');
  const inviter = (await getUser(row.invitedBy)) ?? by;
  await sendInviteMail(req, row.email, token, boardTitle, by, row.role);
  return toPending(row, inviter.name);
}

const deadLink = () => notFound('This invite link is no longer valid. Ask for a new invite.');

/** What the link is for, without using it (the invite page shows it before sign-up). */
export async function previewInvite(token: string): Promise<InvitePreview> {
  const row = token ? await repo.findLiveInvite(hash(token), Date.now()) : null;
  const title = row ? await getBoardTitle(row.boardId) : null;
  if (!row || title === null) throw deadLink();
  const inviter = await getUser(row.invitedBy);
  return { boardTitle: title, inviterName: inviter?.name ?? 'Someone', email: row.email, role: row.role, expiresAt: row.expiresAt };
}

/** Uses the invite for the signed-in user. Single use: a second call (or a concurrent one) gets 404. */
export async function acceptInvite(token: string, user: { id: string; email: string }): Promise<{ boardId: string; role: Role }> {
  const row = token ? await repo.takeInvite(hash(token), Date.now()) : null;
  if (!row) throw deadLink();
  const access = await getBoardAccess(row.boardId, user.id);
  if (!access.exists) throw deadLink();
  if (access.ownerId !== user.id) {
    if (!(await repo.grantAtLeast(row.boardId, user.id, row.role, Date.now()))) throw deadLink();
    await refreshBoardAccess(row.boardId);
  }
  // The link was mailed to that address: following it proves the address (and converts the
  // other invites sent to it).
  if (row.email === user.email) await markEmailVerified(user.id, user.email);
  const { role } = await getBoardAccess(row.boardId, user.id);
  if (!role) throw deadLink();
  return { boardId: row.boardId, role };
}

/** The user just proved `email`: every live invite sent to it becomes a membership. */
export async function convertInvitesFor(user: { id: string; email: string }): Promise<void> {
  for (const row of await repo.takeInvitesForEmail(user.email, Date.now())) {
    const access = await getBoardAccess(row.boardId, user.id);
    if (!access.exists || access.ownerId === user.id) continue;
    if (await repo.grantAtLeast(row.boardId, user.id, row.role, Date.now())) await refreshBoardAccess(row.boardId);
  }
}
