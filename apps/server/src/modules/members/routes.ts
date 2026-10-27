import { Router } from 'express';
import type { BoardMember, Role, User } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, HttpError, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, findUserByEmail, getUser, getUsers, requireUser } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
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
      const { ownerId, role: myRole } = await requireBoardAccess(boardId, currentUser(req).id, 'editor');
      const { email, role } = (req.body ?? {}) as { email?: unknown; role?: unknown };
      if (typeof email !== 'string' || !email.trim()) throw badRequest('email is required');
      if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
      const invitee = await findUserByEmail(email);
      if (!invitee) throw notFound('No Freero account with that email');
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
      res.status(201).json({ member: toMember(invitee, role, true) });
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
