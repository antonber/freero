// POST /api/objects/resolve — addresses → permission-checked summaries, one batch per call (smart
// links, embeds). Visitors on a board's link (guests) may ask too: they learn only about what
// their one board lets them see.
import { Router } from 'express';
import { MAX_RESOLVE_URIS, type ResolveObjectsResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { actorId, currentActor, requireUserOrGuest } from '../auth/index';
import { appOrigins } from './origins';
import { resolveObjects } from './registry';

export default function objectRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.post(
    '/objects/resolve',
    requireUserOrGuest,
    handle(async (req, res) => {
      const uris = (req.body as { uris?: unknown } | undefined)?.uris;
      if (!Array.isArray(uris) || uris.some((u) => typeof u !== 'string')) throw badRequest('uris must be an array of strings');
      if (uris.length > MAX_RESOLVE_URIS) throw badRequest(`At most ${MAX_RESOLVE_URIS} addresses per call`);
      const objects = await resolveObjects({ userId: actorId(currentActor(req)) }, uris as string[], appOrigins(req));
      res.json({ objects } satisfies ResolveObjectsResponse);
    }),
  );
  return r;
}
