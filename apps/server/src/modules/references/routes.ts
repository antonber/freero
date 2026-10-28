// GET /api/objects/backlinks?uri=<address> — "what links here", only sources the caller may see.
import { Router } from 'express';
import type { BacklinksResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { actorId, currentActor, requireUserOrGuest } from '../auth/index';
import { appOrigins } from '../objects/index';
import { backlinksOf } from './service';

export default function referenceRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.get(
    '/objects/backlinks',
    requireUserOrGuest,
    handle(async (req, res) => {
      const backlinks = await backlinksOf({ userId: actorId(currentActor(req)) }, req.query.uri, appOrigins(req));
      res.json({ backlinks } satisfies BacklinksResponse);
    }),
  );
  return r;
}
