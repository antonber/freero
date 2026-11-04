import { Router } from 'express';
import type { ActivityResponse, CatchUpChanges, CatchUpSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { actorId, currentActor, currentUser, requireUser, requireUserOrGuest } from '../auth/index';
import { catchUpChanges, catchUpSummary } from './catchUp';
import { boardActivity, workspaceActivity } from './service';

const page = (q: Record<string, unknown>) => {
  const before = Number(q.before);
  const limit = Number(q.limit);
  return { before: Number.isFinite(before) && before > 0 ? before : null, limit: Number.isFinite(limit) && limit > 0 ? limit : undefined };
};

export default function activityRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // Guests may read their board's activity too (the panel on the board).
  r.get(
    '/boards/:id/activity',
    requireUserOrGuest,
    handle(async (req, res) => {
      res.json((await boardActivity(req.params.id, actorId(currentActor(req)), page(req.query))) satisfies ActivityResponse);
    }),
  );

  // Changes since your last visit: accounts only (guests have no marker).
  r.get(
    '/boards/:id/catch-up',
    requireUser,
    handle(async (req, res) => {
      res.json((await catchUpSummary(req.params.id, currentUser(req).id)) satisfies CatchUpSummary);
    }),
  );

  r.get(
    '/boards/:id/catch-up/changes',
    requireUser,
    handle(async (req, res) => {
      res.json((await catchUpChanges(req.params.id, currentUser(req).id)) satisfies CatchUpChanges);
    }),
  );

  r.get(
    '/workspaces/:id/activity',
    requireUser,
    handle(async (req, res) => {
      const projectId = typeof req.query.project === 'string' && req.query.project ? req.query.project : undefined;
      res.json((await workspaceActivity(req.params.id, currentUser(req).id, { ...page(req.query), projectId })) satisfies ActivityResponse);
    }),
  );

  return r;
}
