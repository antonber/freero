import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { createGroup, deleteGroup, listGroupMembers, listGroups, renameGroup, setGroupMember } from './groups';
import { acceptInvite, inviteToWorkspace, listInvites, previewInvite, resendInvite, revokeInvite } from './invites';
import {
  addOrganisationMember,
  attachWorkspace,
  createOrganisation,
  deleteOrganisation,
  detachWorkspace,
  listOrganisations,
  organisationWorkspaceMembers,
  organisationWorkspaces,
} from './organisations';
import {
  addProjectMember,
  listProjectGroups,
  setProjectGroup,
  createProject,
  deleteProject,
  listProjectMembers,
  listProjects,
  removeProjectMember,
  setProjectPinned,
  updateProject,
} from './projects';
import {
  changeRole,
  cleanName,
  createTeamWorkspace,
  deleteWorkspace,
  listMembers,
  listWorkspaces,
  removeMember,
  transferWorkspace,
  updateWorkspace,
} from './service';

export default function workspaceRoutes(_ctx: ServerContext): Router {
  const r = Router();
  // requireUser on each route, never `r.use('/workspaces', …)`: other modules serve under
  // /workspaces/:id too (admin, activity, scim…), and router-level middleware would run for theirs
  // depending on module order (dune-check S6, KAI-190).

  r.get(
    '/workspaces',
    requireUser,
    handle(async (req, res) => {
      res.json({ workspaces: await listWorkspaces(currentUser(req).id) });
    }),
  );

  r.post(
    '/workspaces',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ workspace: await createTeamWorkspace(currentUser(req).id, cleanName(req.body?.name)) });
    }),
  );

  r.patch(
    '/workspaces/:id',
    requireUser,
    handle(async (req, res) => {
      res.json({ workspace: await updateWorkspace(req.params.id, currentUser(req).id, (req.body ?? {}) as Record<string, unknown>) });
    }),
  );

  r.delete(
    '/workspaces/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteWorkspace(req, req.params.id, currentUser(req).id, req.body?.confirm);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/workspaces/:id/transfer',
    requireUser,
    handle(async (req, res) => {
      res.json({ workspace: await transferWorkspace(req.params.id, currentUser(req).id, req.body?.userId) });
    }),
  );

  // ---- organisations (#108) ----
  r.get(
    '/organisations',
    requireUser,
    handle(async (req, res) => {
      res.json({ organisations: await listOrganisations(currentUser(req).id) });
    }),
  );

  r.post(
    '/organisations',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ organisation: await createOrganisation(currentUser(req).id, req.body?.name) });
    }),
  );

  r.delete(
    '/organisations/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteOrganisation(req.params.id, currentUser(req).id, req.body?.confirm);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/organisations/:id/workspaces',
    requireUser,
    handle(async (req, res) => {
      res.json({ workspaces: await organisationWorkspaces(req.params.id, currentUser(req).id) });
    }),
  );

  r.post(
    '/organisations/:id/workspaces',
    requireUser,
    handle(async (req, res) => {
      res.status(201).json({ workspace: await attachWorkspace(req.params.id, req.body?.workspaceId, currentUser(req).id) });
    }),
  );

  r.delete(
    '/organisations/:id/workspaces/:workspaceId',
    requireUser,
    handle(async (req, res) => {
      await detachWorkspace(req.params.id, req.params.workspaceId, currentUser(req).id);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/organisations/:id/workspaces/:workspaceId/members',
    requireUser,
    handle(async (req, res) => {
      res.json({ members: await organisationWorkspaceMembers(req.params.id, req.params.workspaceId, currentUser(req).id) });
    }),
  );

  r.post(
    '/organisations/:id/members',
    requireUser,
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ member: await addOrganisationMember(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  // ---- members ----
  r.get(
    '/workspaces/:id/members',
    requireUser,
    handle(async (req, res) => {
      const userId = currentUser(req).id;
      const members = await listMembers(req.params.id, userId);
      res.json({ members, invites: await listInvites(req.params.id, userId) });
    }),
  );

  r.post(
    '/workspaces/:id/members',
    requireUser,
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.status(201).json(await inviteToWorkspace(req, req.params.id, currentUser(req), req.body ?? {}));
    }),
  );

  r.patch(
    '/workspaces/:id/members/:userId',
    requireUser,
    handle(async (req, res) => {
      res.json({ member: await changeRole(req.params.id, currentUser(req).id, req.params.userId, req.body?.role, req.body?.adminScopes) });
    }),
  );

  r.delete(
    '/workspaces/:id/members/:userId',
    requireUser,
    handle(async (req, res) => {
      await removeMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/workspaces/:id/invites/:inviteId/resend',
    requireUser,
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.json({ invite: await resendInvite(req, req.params.id, req.params.inviteId, currentUser(req)) });
    }),
  );

  r.delete(
    '/workspaces/:id/invites/:inviteId',
    requireUser,
    handle(async (req, res) => {
      await revokeInvite(req.params.id, req.params.inviteId, currentUser(req).id);
      res.json({ ok: true });
    }),
  );

  // The emailed link: previewing needs no account (the page offers sign-up); accepting does.
  r.get(
    '/workspace-invites/:token',
    handle(async (req, res) => {
      res.json({ invite: await previewInvite(req.params.token) });
    }),
  );

  r.post(
    '/workspace-invites/:token/accept',
    requireUser,
    handle(async (req, res) => {
      res.json(await acceptInvite(req.params.token, currentUser(req)));
    }),
  );

  // ---- projects ----
  r.get(
    '/workspaces/:id/projects',
    requireUser,
    handle(async (req, res) => {
      res.json({ projects: await listProjects(req.params.id, currentUser(req).id) });
    }),
  );

  r.post(
    '/workspaces/:id/projects',
    requireUser,
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ project: await createProject(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  r.patch(
    '/projects/:id',
    requireUser,
    handle(async (req, res) => {
      res.json({ project: await updateProject(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  r.delete(
    '/projects/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteProject(req.params.id, currentUser(req).id, { boards: req.query.boards });
      res.json({ ok: true });
    }),
  );

  // Pinned to the top of your own sidebar (#129).
  r.put(
    '/projects/:id/pin',
    requireUser,
    handle(async (req, res) => {
      await setProjectPinned(req.params.id, currentUser(req).id, true);
      res.json({ ok: true });
    }),
  );
  r.delete(
    '/projects/:id/pin',
    requireUser,
    handle(async (req, res) => {
      await setProjectPinned(req.params.id, currentUser(req).id, false);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/projects/:id/members',
    requireUser,
    handle(async (req, res) => {
      res.json({ members: await listProjectMembers(req.params.id, currentUser(req).id) });
    }),
  );

  r.put(
    '/projects/:id/members/:userId',
    requireUser,
    handle(async (req, res) => {
      await addProjectMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/projects/:id/members/:userId',
    requireUser,
    handle(async (req, res) => {
      await removeProjectMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  // ---- user groups (#63) ----
  r.get(
    '/workspaces/:id/groups',
    requireUser,
    handle(async (req, res) => {
      res.json(await listGroups(req.params.id, currentUser(req).id));
    }),
  );
  r.post(
    '/workspaces/:id/groups',
    requireUser,
    handle(async (req, res) => {
      res.status(201).json({ group: await createGroup(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );
  r.patch(
    '/groups/:id',
    requireUser,
    handle(async (req, res) => {
      res.json({ group: await renameGroup(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );
  r.delete(
    '/groups/:id',
    requireUser,
    handle(async (req, res) => {
      await deleteGroup(req.params.id, currentUser(req).id);
      res.json({ ok: true });
    }),
  );
  r.get(
    '/groups/:id/members',
    requireUser,
    handle(async (req, res) => {
      res.json({ members: await listGroupMembers(req.params.id, currentUser(req).id) });
    }),
  );
  for (const [verb, member] of [
    ['put', true],
    ['delete', false],
  ] as const)
    r[verb](
      '/groups/:id/members/:userId',
      requireUser,
      handle(async (req, res) => {
        res.json({ group: await setGroupMember(req.params.id, currentUser(req).id, req.params.userId, member) });
      }),
    );
  r.get(
    '/projects/:id/groups',
    requireUser,
    handle(async (req, res) => {
      res.json({ groups: await listProjectGroups(req.params.id, currentUser(req).id) });
    }),
  );
  for (const [verb, shared] of [
    ['put', true],
    ['delete', false],
  ] as const)
    r[verb](
      '/projects/:id/groups/:groupId',
      requireUser,
      handle(async (req, res) => {
        res.json({ groups: await setProjectGroup(req.params.id, currentUser(req).id, req.params.groupId, shared) });
      }),
    );

  return r;
}
