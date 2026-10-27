import { Router } from 'express';
import type { BoardMember, Role, User } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, HttpError, notFound } from '../../platform/http';
import { currentUser, findUserByEmail, getUser, requireUser } from '../auth/index';
import { requireBoardAccess } from '../boards/index';
import { refreshBoardAccess } from '../realtime/index';
import * as repo from './repo';
import { isMemberRole } from './roles';

const toMember = (u: User, role: Role): BoardMember => ({
  userId: u.id,
  name: u.name,
  email: u.email,
  color: u.color,
  avatarUrl: u.avatarUrl,
  role,
});

export default function memberRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.use('/boards/:id/members', requireUser);

  r.get(
    '/boards/:id/members',
    handle((req, res) => {
      const boardId = req.params.id;
      const { ownerId } = requireBoardAccess(boardId, currentUser(req).id);
      const members: BoardMember[] = [];
      const owner = getUser(ownerId);
      if (owner) members.push(toMember(owner, 'owner'));
      for (const m of repo.listByBoard(boardId)) {
        const u = getUser(m.userId);
        if (u) members.push(toMember(u, m.role));
      }
      res.json({ members });
    }),
  );

  r.post(
    '/boards/:id/members',
    handle((req, res) => {
      const boardId = req.params.id;
      const { ownerId } = requireBoardAccess(boardId, currentUser(req).id, 'editor');
      const { email, role } = (req.body ?? {}) as { email?: unknown; role?: unknown };
      if (typeof email !== 'string' || !email.trim()) throw badRequest('email is required');
      if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
      const invitee = findUserByEmail(email);
      if (!invitee) throw notFound('No Freero account with that email');
      if (invitee.id === ownerId) throw new HttpError(409, 'That person already owns this board');
      repo.upsertMember(boardId, invitee.id, role, Date.now());
      refreshBoardAccess(boardId);
      res.status(201).json({ member: toMember(invitee, role) });
    }),
  );

  r.patch(
    '/boards/:id/members/:userId',
    handle((req, res) => {
      const { id: boardId, userId } = req.params;
      requireBoardAccess(boardId, currentUser(req).id, 'owner');
      const role = req.body?.role;
      if (!isMemberRole(role)) throw badRequest('role must be editor, commenter or viewer');
      const existing = repo.getMembership(boardId, userId);
      const u = getUser(userId);
      if (!existing || !u) throw notFound('That person is not a member of this board');
      repo.setRole(boardId, userId, role);
      refreshBoardAccess(boardId);
      res.json({ member: toMember(u, role) });
    }),
  );

  r.delete(
    '/boards/:id/members/:userId',
    handle((req, res) => {
      const { id: boardId, userId } = req.params;
      const me = currentUser(req);
      const { role } = requireBoardAccess(boardId, me.id);
      if (role !== 'owner' && userId !== me.id) throw forbidden('Only the board owner can remove members');
      if (!repo.getMembership(boardId, userId)) throw notFound('That person is not a member of this board');
      repo.removeMember(boardId, userId);
      refreshBoardAccess(boardId);
      res.json({ ok: true });
    }),
  );

  return r;
}
