// Presenting (#146): POST /api/boards/:id/presentation (see @freero/shared api.ts).
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentActor, requireUserOrGuest } from '../auth/index';
import { present } from './service';

export default function presentationRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.post(
    '/boards/:id/presentation',
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => {
      res.json({ session: await present(req.params.id, currentActor(req), (req.body ?? {}) as Record<string, unknown>) });
    }),
  );
  return r;
}
