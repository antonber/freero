// Icebreakers (#150): POST /api/boards/:id/icebreakers/:elementId/roll (see @freero/shared api.ts).
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentActor, requireUserOrGuest } from '../auth/index';
import { roll } from './service';

export default function icebreakerRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.post(
    '/boards/:id/icebreakers/:elementId/roll',
    requireUserOrGuest,
    rateLimit('engage', 'user'),
    handle(async (req, res) => {
      res.json({ result: await roll(req.params.id, req.params.elementId, currentActor(req)) });
    }),
  );
  return r;
}
