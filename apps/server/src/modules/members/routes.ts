import { Router } from 'express';
import type { AcceptInviteResponse, BoardMember, InviteResponse, Role, User } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, HttpError, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, findUserByEmail, getUser, getUsers, normalizeEmail, requireUser } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import { acceptInvite, inviteByEmail, listPending, previewInvite, resendInvite } from './invites';
import * as repo from './repo';
import { atLeast, isMemberRole } from './roles';

/**
 * Emails are only shown to people who can manage sharing (owner, editors): anyone with a "can
 * view" link would otherwise harvest every collaborator's address.
 */
const toMember = (u: User, role: Role, withEmail: boolean): BoardMember => ({
  userId: u.id,
  name: u.name,
  ...(withEmail ? { email: u.email } : {}),
  color: u.color,
  avatarUrl: u.avatarUrl,
  role,
});

const boardGone = () => notFound('Board not found');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function memberRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.use('/boards/:id/members', requireUser);

  r.get(
    '/boards/:id/members',
    handle(async (req, res) => {
      const boardId = req.params.id;
      const me = currentUser(req);
      const { ownerId, role: myRole } = await requireBoardAccess(boardId, me.id);
      const emails = atLeast(myRole, 'editor');
      const rows = await repo.listByBoard(boardId);
      const users = await getUsers([ownerId, ...rows.map((m) => m.userId)]);
      const members: BoardMember[] = [];
      const owner = users.get(ownerId);
      if (owner) members.push(toMember(owner, 'owner', emails || owner.id === me.id));
      for (const m of rows) {
        const u = users.get(m.userId);
        if (u) members.push(toMember(u, m.role, emails || u.id === me.id));
      }
      res.json({ members });
    }),
  );

  r.post(
    '/boards/:id/members',
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      const boardId = req.params.id;
      const me = currentUser(req);
      const { ownerId, role: myRole, title, canShareExternally, inWorkspace } = await requireBoardAccess(boardId, me.id, 'editor');
      const { email: rawEmail, role } = (req.body ?? {}) as { email?: unknown; role?: unknown };
      const email = normalizeEmail(rawEmail);
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
        res.status(201).json({ invite: out } satisfies InviteResponse);
        return;
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
        if (now !== role)
          throw new HttpError(409, `${invitee.name} already has access. Only the board owner can change their role.`);
      }
      await refreshBoardAccess(boardId);
      res.status(201).json({ member: toMember(invitee, role, true) } satisfies InviteResponse);
    }),
  );

  // ---- pending invites ----
  r.use('/boards/:id/invites', requireUser);

  r.get(
    '/boards/:id/invites',
    handle(async (req, res) => {
      await requireBoardAccess(req.params.id, currentUser(req).id, 'editor');
      res.json({ invites: await listPending(req.params.id) });
    }),
  );

  r.post(
    '/boards/:id/invites/:inviteId/resend',
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      const me = currentUser(req);
      const { title, canShareExternally } = await requireBoardAccess(req.params.id, me.id, 'editor');
      if (!me.emailVerified) throw forbidden('Verify your email address before inviting people');
      if (!canShareExternally) throw forbidden('This workspace only lets you share its boards with people in it');
      res.json({ invite: await resendInvite(req, req.params.id, title, req.params.inviteId, me) });
    }),
  );

  r.delete(
    '/boards/:id/invites/:inviteId',
    handle(async (req, res) => {
      const me = currentUser(req);
      const { role } = await requireBoardAccess(req.params.id, me.id, 'editor');
      // The owner revokes any invite; an editor only the ones they sent.
      if (!(await repo.deleteInvite(req.params.id, req.params.inviteId, role === 'owner' ? null : me.id)))
        throw notFound('No such pending invite (or it was sent by someone else)');
      res.json({ ok: true });
    }),
  );

  // The emailed link. Previewing needs no account (the page offers sign-up); accepting does.
  r.get(
    '/invites/:token',
    handle(async (req, res) => {
      res.json({ invite: await previewInvite(req.params.token) });
    }),
  );

  r.post(
    '/invites/:token/accept',
    requireUser,
    handle(async (req, res) => {
      res.json((await acceptInvite(req.params.token, currentUser(req))) satisfies AcceptInviteResponse);
    }),
  );

  r.patch(
    '/boards/:id/members/:userId',
    handle(async (req, res) => {
      const { id: boardId, userId } = req.params;
      await requireBoardAccess(boardId, currentUser(req).id, 'owner');
      const role = req.body?.role;
      if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
      const u = await getUser(userId);
      if (!u || !(await repo.setRole(boardId, userId, role))) throw notFound('That person is not a member of this board');
      await refreshBoardAccess(boardId);
      res.json({ member: toMember(u, role, true) });
    }),
  );

  r.delete(
    '/boards/:id/members/:userId',
    handle(async (req, res) => {
      const { id: boardId, userId } = req.params;
      const me = currentUser(req);
      const { role } = await requireBoardAccess(boardId, me.id);
      if (role !== 'owner' && userId !== me.id) throw forbidden('Only the board owner can remove members');
      if (!(await repo.removeMember(boardId, userId))) throw notFound('That person is not a member of this board');
      await refreshBoardAccess(boardId);
      res.json({ ok: true });
    }),
  );

  return r;
}
