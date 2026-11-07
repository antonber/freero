// Pending invites: sharing a board with an address that has no Freero account yet.
//
// The invitee gets an emailed link /invite/<token> (256-bit random; only its sha256 is stored).
// Opening it while signed in — or after signing up / logging in from it — accepts it: the invite
// row is deleted and becomes a membership (single use; expired or revoked invites grant nothing).
// Proving the address another way (the verification link) converts every live invite sent to it.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { InvitePreview, PendingInvite, Role, User } from '@freero/shared';
import { HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { getUser, getUsers, localeOfEmail, localesOf, markEmailVerified } from '../auth/index';
import { getBoardAccess, getBoardTitle, lockBoardSharing, requireBoardAccess } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import { inviteAccepted } from './events';
import { t } from './messages';
import * as repo from './repo';
import type { MemberRole } from './roles';

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

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
    // The invitee's language if the address has an account, else the inviter's (#5).
    const locale = (await localeOfEmail(to)) ?? (await localesOf([inviter.id])).get(inviter.id) ?? null;
    const vars = { inviter: inviter.name, board: boardTitle, email: inviter.email, role };
    await sendMail({
      to,
      ...renderMail({
        locale,
        subject: t(locale, 'invite.subject', vars),
        title: t(locale, 'invite.title', vars),
        paragraphs: [t(locale, 'invite.body', vars)],
        action: { label: t(locale, 'invite.action'), url: appUrl(req, `/invite/${token}`) },
        outro: t(locale, 'invite.outro', vars),
      }),
    });
  } catch (e) {
    // The invite exists either way; the share dialog can resend it.
    logError('members: could not send an invite email', e);
  }
}

/** A pending invite just saved, with the link to mail (only its hash is stored). */
export interface SavedInvite {
  invite: PendingInvite;
  token: string;
  role: MemberRole;
}

/**
 * Saves the invite of an address without an account (or renews its pending invite: new link, new
 * expiry), without mailing it: the caller mails it (`mailInvite`) once its transaction committed.
 * 'role-conflict' when an editor tried to change the role of an existing invite.
 */
export async function saveInviteByEmail(a: { boardId: string; email: string; role: MemberRole; inviter: User; mayChangeRole: boolean }): Promise<SavedInvite | 'role-conflict' | 'board-gone'> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const saved = await repo.saveInvite(
    { id: newId(16), boardId: a.boardId, email: a.email, role: a.role, tokenHash: hash(token), invitedBy: a.inviter.id, now, expiresAt: now + INVITE_TTL_MS },
    a.mayChangeRole,
  );
  if (typeof saved === 'string') return saved;
  return { invite: toPending(saved, a.inviter.name), token, role: saved.role };
}

export function mailInvite(req: Request | null, saved: SavedInvite, boardTitle: string, inviter: User): Promise<void> {
  return sendInviteMail(req, saved.invite.email, saved.token, boardTitle, inviter, saved.role);
}

/** `saveInviteByEmail`, then the mail. */
export async function inviteByEmail(
  req: Request | null,
  a: { boardId: string; boardTitle: string; email: string; role: MemberRole; inviter: User; mayChangeRole: boolean },
): Promise<PendingInvite | 'role-conflict' | 'board-gone'> {
  const saved = await saveInviteByEmail(a);
  if (typeof saved === 'string') return saved;
  await mailInvite(req, saved, a.boardTitle, a.inviter);
  return saved.invite;
}

/**
 * Sends a pending invite again with a fresh link (the old one stops working), in the name of `by`
 * (whom the caller checked may invite people to the board): it is theirs from now on.
 */
export async function resendInvite(req: Request | null, boardId: string, boardTitle: string, inviteId: string, by: User): Promise<PendingInvite> {
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const row = await repo.renewInvite(boardId, inviteId, hash(token), now, now + INVITE_TTL_MS, by.id);
  if (!row) throw notFound('That invite was already used or revoked');
  await sendInviteMail(req, row.email, token, boardTitle, by, row.role);
  return toPending(row, by.name);
}

const deadLink = () => notFound('This invite link is no longer valid. Ask for a new invite.');

/**
 * May the person who sent this invite still send it? An invite carries its inviter's authority: it
 * opens the board only while they may still invite people to it (editor or more there, and the
 * owner, a co-owner or an editor of a board that lets editors share) and, for an invitee outside
 * the board's workspace (`inviteeId` null: not known yet), may still share outside it. So removing
 * or demoting an inviter, on the board or in its workspace, ends the invites they sent.
 */
async function inviterStillVouches(row: repo.InviteRow, inviteeId: string | null): Promise<boolean> {
  try {
    const access = await requireBoardAccess(row.boardId, row.invitedBy, 'editor');
    if (!access.manages && !access.editorsCanShare) return false;
    return access.canShareExternally || (inviteeId !== null && (await access.inWorkspace(inviteeId)));
  } catch (e) {
    if (e instanceof HttpError) return false;
    throw e;
  }
}

/**
 * Uses one live invite for `user` (single use: of two concurrent uses one gets it) under the board's
 * sharing lock, only while its inviter still vouches for it; `tokenHash`: the link it was opened
 * with (null: the address was proved). 'granted', 'owner' (the board is theirs: used, nothing to
 * grant) or null when it can't be used: the invite is then left as it was.
 */
async function useInvite(row: repo.InviteRow, user: { id: string; email: string }, tokenHash: string | null): Promise<'granted' | 'owner' | null> {
  const used = await repo
    .transaction(async () => {
      await lockBoardSharing(row.boardId);
      const taken = await repo.takeInvite(row.id, Date.now(), tokenHash);
      if (!taken) return null;
      const access = await getBoardAccess(taken.boardId, user.id);
      // Unusable: rolled back, so the invite stays (it works again if its inviter regains the right).
      if (!access.exists || !(await inviterStillVouches(taken, user.id))) throw UNUSABLE;
      if (access.ownerId === user.id) return 'owner' as const;
      if (!(await repo.grantAtLeast(taken.boardId, user.id, taken.role, Date.now(), { actorId: taken.invitedBy }))) throw UNUSABLE;
      return 'granted' as const;
    })
    .catch((e: unknown) => {
      if (e === UNUSABLE) return null;
      throw e;
    });
  if (used === 'granted') await refreshBoardAccess(row.boardId);
  return used;
}
const UNUSABLE = Symbol('unusable invite');

/** What the link is for, without using it (the invite page shows it before sign-up). */
export async function previewInvite(token: string): Promise<InvitePreview> {
  const row = token ? await repo.findLiveInvite(hash(token), Date.now()) : null;
  const title = row ? await getBoardTitle(row.boardId) : null;
  if (!row || title === null || !(await inviterStillVouches(row, null))) throw deadLink();
  const inviter = await getUser(row.invitedBy);
  return { boardTitle: title, inviterName: inviter?.name ?? 'Someone', email: row.email, role: row.role, expiresAt: row.expiresAt };
}

/** Uses the invite for the signed-in user. Single use: a second call (or a concurrent one) gets 404. */
export async function acceptInvite(token: string, user: { id: string; email: string }): Promise<{ boardId: string; role: Role }> {
  const row = token ? await repo.findLiveInvite(hash(token), Date.now()) : null;
  if (!row || !(await useInvite(row, user, hash(token)))) throw deadLink();
  // The link was mailed to that address: following it proves the address (and converts the
  // other invites sent to it).
  if (row.email === user.email) await markEmailVerified(user.id, user.email);
  const { role } = await getBoardAccess(row.boardId, user.id);
  if (!role) throw deadLink();
  await inviteAccepted({ boardId: row.boardId, userId: user.id, email: row.email });
  return { boardId: row.boardId, role };
}

/** The user just proved `email`: every live invite sent to it, that its inviter may still send, becomes a membership. */
export async function convertInvitesFor(user: { id: string; email: string }): Promise<void> {
  for (const row of await repo.liveInvitesFor(user.email, Date.now())) {
    if ((await useInvite(row, user, null)) === 'granted') await inviteAccepted({ boardId: row.boardId, userId: user.id, email: row.email });
  }
}

/** Whether a live invite someone may still send was sent to `email` (an invite-only server lets that address sign up). */
export async function hasUsableInviteFor(email: string): Promise<boolean> {
  for (const row of await repo.liveInvitesFor(email, Date.now())) if (await inviterStillVouches(row, null)) return true;
  return false;
}

/** Which of `emails` have a live (unexpired) invite to the board. */
export async function invitedEmails(boardId: string, emails: string[]): Promise<string[]> {
  if (!emails.length) return [];
  const now = Date.now();
  const live = new Set((await repo.listInvites(boardId)).filter((i) => i.expiresAt > now).map((i) => i.email));
  return emails.filter((e) => live.has(e));
}
