// A person's own view settings on a board (Host.personalViews): only their own, for boards they
// can open. Guests keep theirs in their browser (no account for them to follow).
import { Router } from 'express';
import type { PersonalViewsResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { currentUser, requireUser } from '../auth/index';
import { listPersonalViews, savePersonalView } from './service';

export default function personalViewRoutes(_ctx: ServerContext): Router {
  const r = Router();

  r.get(
    '/boards/:id/personal-views',
    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ views: await listPersonalViews(req.params.id, currentUser(req).id) } satisfies PersonalViewsResponse);
    }),
  );

  r.put(
    '/boards/:id/personal-views',
    requireUser,
    handle(async (req, res) => {
      await savePersonalView(req.params.id, currentUser(req).id, req.body);
      res.json({ ok: true });
    }),
  );

  return r;
}
