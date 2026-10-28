import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { acceptInvite, inviteToWorkspace, listInvites, previewInvite, resendInvite, revokeInvite } from './invites';
import {
  addProjectMember,
  createProject,
  deleteProject,
  listProjectMembers,
  listProjects,
  removeProjectMember,
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
  r.use('/workspaces', requireUser);
  r.use('/projects', requireUser);

  r.get(
    '/workspaces',
    handle(async (req, res) => {
      res.json({ workspaces: await listWorkspaces(currentUser(req).id) });
    }),
  );

  r.post(
    '/workspaces',
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ workspace: await createTeamWorkspace(currentUser(req).id, cleanName(req.body?.name)) });
    }),
  );

  r.patch(
    '/workspaces/:id',
    handle(async (req, res) => {
      res.json({ workspace: await updateWorkspace(req.params.id, currentUser(req).id, (req.body ?? {}) as Record<string, unknown>) });
    }),
  );

  r.delete(
    '/workspaces/:id',
    handle(async (req, res) => {
      await deleteWorkspace(req, req.params.id, currentUser(req).id, req.body?.confirm);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/workspaces/:id/transfer',
    handle(async (req, res) => {
      res.json({ workspace: await transferWorkspace(req.params.id, currentUser(req).id, req.body?.userId) });
    }),
  );

  // ---- members ----
  r.get(
    '/workspaces/:id/members',
    handle(async (req, res) => {
      const userId = currentUser(req).id;
      const members = await listMembers(req.params.id, userId);
      res.json({ members, invites: await listInvites(req.params.id, userId) });
    }),
  );

  r.post(
    '/workspaces/:id/members',
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.status(201).json(await inviteToWorkspace(req, req.params.id, currentUser(req), req.body ?? {}));
    }),
  );

  r.patch(
    '/workspaces/:id/members/:userId',
    handle(async (req, res) => {
      res.json({ member: await changeRole(req.params.id, currentUser(req).id, req.params.userId, req.body?.role) });
    }),
  );

  r.delete(
    '/workspaces/:id/members/:userId',
    handle(async (req, res) => {
      await removeMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  r.post(
    '/workspaces/:id/invites/:inviteId/resend',
    rateLimit('invite', 'user'),
    handle(async (req, res) => {
      res.json({ invite: await resendInvite(req, req.params.id, req.params.inviteId, currentUser(req)) });
    }),
  );

  r.delete(
    '/workspaces/:id/invites/:inviteId',
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
    handle(async (req, res) => {
      res.json({ projects: await listProjects(req.params.id, currentUser(req).id) });
    }),
  );

  r.post(
    '/workspaces/:id/projects',
    rateLimit('boardCreate', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ project: await createProject(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  r.patch(
    '/projects/:id',
    handle(async (req, res) => {
      res.json({ project: await updateProject(req.params.id, currentUser(req).id, req.body ?? {}) });
    }),
  );

  r.delete(
    '/projects/:id',
    handle(async (req, res) => {
      await deleteProject(req.params.id, currentUser(req).id);
      res.json({ ok: true });
    }),
  );

  r.get(
    '/projects/:id/members',
    handle(async (req, res) => {
      res.json({ members: await listProjectMembers(req.params.id, currentUser(req).id) });
    }),
  );

  r.put(
    '/projects/:id/members/:userId',
    handle(async (req, res) => {
      await addProjectMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  r.delete(
    '/projects/:id/members/:userId',
    handle(async (req, res) => {
      await removeProjectMember(req.params.id, currentUser(req).id, req.params.userId);
      res.json({ ok: true });
    }),
  );

  return r;
}
