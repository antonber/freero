import { Router } from 'express';
import { guestDisplayName, type AcceptInviteResponse, type AccessRequestState, type BoardPerson, type InviteResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, forbidden, handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { actorId, currentActor, currentUser, getGuests, getUsers, requireUser, requireUserOrGuest } from '../auth/index';
import { requireBoardAccess, teamAccessUserIds } from '../boards/index';
import { commentPeopleOf } from '../realtime/index';
import { decideRequest, listRequests, requestAccess, requestState, withdrawRequest } from './accessRequests';
import { acceptInvite, listPending, previewInvite, resendInvite } from './invites';
import * as repo from './repo';
import { inviteBoardMember, listBoardMembers, removeBoardMember, setBoardMemberRole } from './service';

const MAX_PEOPLE = 100;

export default function memberRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.use('/boards/:id/members', requireUser);

  r.get(
    '/boards/:id/members',
    handle(async (req, res) => {
      res.json({ members: await listBoardMembers(req.params.id, currentUser(req).id) });
    }),
  );

  r.post(
    '/boards/:id/members',
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.status(201).json((await inviteBoardMember(req, req.params.id, currentUser(req), req.body ?? {})) satisfies InviteResponse);
    }),
  );

  // Profiles for ids a board shows (comment authors, @mentions), including people who left it.
  // Guests may ask too (their board only): names and photos, never emails.
  r.get(
    '/boards/:id/people',
    requireUserOrGuest,
    handle(async (req, res) => {
      const boardId = req.params.id;
      const reader = actorId(currentActor(req));
      const { ownerId, role } = await requireBoardAccess(boardId, reader);
      const ids = [...new Set(String(req.query.ids ?? '').split(',').filter(Boolean))];
      if (ids.length > MAX_PEOPLE) throw badRequest(`At most ${MAX_PEOPLE} ids`);
      const onBoard = new Set([ownerId, ...(await repo.listByBoard(boardId)).map((m) => m.userId), ...(await teamAccessUserIds(boardId))]);
      // Only people the board already shows somewhere: never a lookup of arbitrary accounts.
      const inComments = ids.some((id) => !onBoard.has(id)) ? await commentPeopleOf(boardId, { userId: reader, role }) : new Set<string>();
      const shown = ids.filter((id) => onBoard.has(id) || inComments.has(id));
      const [users, guests] = await Promise.all([getUsers(shown), getGuests(shown)]);
      const people: BoardPerson[] = [
        ...[...users.values()].map((u) => ({ id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl })),
        // Guests who commented here, while their session lasts (their comments keep the name after).
        ...[...guests.values()].filter((g) => g.boardId === boardId).map((g) => ({ id: g.id, name: guestDisplayName(g.name), color: g.color, avatarUrl: null })),
      ];
      res.json({ people });
    }),
  );

  // ---- access requests ----
  r.get(
    '/boards/:id/access-request',
    requireUser,
    handle(async (req, res) => {
      res.json((await requestState(req.params.id, currentUser(req).id)) satisfies AccessRequestState);
    }),
  );

  r.post(
    '/boards/:id/access-request',
    requireUser,
    rateLimit('accessRequest', 'user'),
    handle(async (req, res) => {
      res.status(201).json((await requestAccess(req.params.id, currentUser(req), req.body ?? {})) satisfies AccessRequestState);
    }),
  );

  r.delete(
    '/boards/:id/access-request',
    requireUser,
    handle(async (req, res) => {
      res.json((await withdrawRequest(req.params.id, currentUser(req).id)) satisfies AccessRequestState);
    }),
  );

  r.get(
    '/boards/:id/access-requests',
    requireUser,
    handle(async (req, res) => {
      res.json({ requests: await listRequests(req.params.id, currentUser(req).id) });
    }),
  );

  r.post(
    '/boards/:id/access-requests/:userId',
    requireUser,
    handle(async (req, res) => {
      await decideRequest(req.params.id, currentUser(req), req.params.userId, req.body ?? {});
      res.json({ ok: true });
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
      res.json({ member: await setBoardMemberRole(req.params.id, currentUser(req).id, req.params.userId, req.body?.role) });
    }),
  );

  r.delete(
    '/boards/:id/members/:userId',
    handle(async (req, res) => {
      await removeBoardMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  return r;
}
