// The admin console's audit streams (owners/admins of a team workspace; checked by every route):
//   GET    /api/workspaces/:id/admin/siem                 list
//   POST   /api/workspaces/:id/admin/siem                 add (https: answers the signing secret, once)
//   PATCH  /api/workspaces/:id/admin/siem/:sinkId         change settings / secret / on-off (rotateSigningSecret)
//   POST   /api/workspaces/:id/admin/siem/:sinkId/test    send a test record now
//   DELETE /api/workspaces/:id/admin/siem/:sinkId         remove
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { createSink, deleteSink, listSinks, testSink, updateSink } from './service';

const BASE = '/workspaces/:id/admin/siem';

export default function siemRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const body = (b: unknown) => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
  r.get(BASE, requireUser, handle(async (req, res) => res.json({ sinks: await listSinks(req.params.id, currentUser(req).id) })));
  r.post(BASE, requireUser, handle(async (req, res) => res.status(201).json(await createSink(req.params.id, currentUser(req).id, body(req.body)))));
  r.patch(`${BASE}/:sinkId`, requireUser, handle(async (req, res) => res.json(await updateSink(req.params.id, currentUser(req).id, req.params.sinkId, body(req.body)))));
  r.post(
    `${BASE}/:sinkId/test`,
    requireUser,
    rateLimit('sso', 'user'),
    handle(async (req, res) => res.json({ sink: await testSink(req.params.id, currentUser(req).id, req.params.sinkId) })),
  );
  r.delete(
    `${BASE}/:sinkId`,
    requireUser,
    handle(async (req, res) => {
      await deleteSink(req.params.id, currentUser(req).id, req.params.sinkId);
      res.json({ ok: true });
    }),
  );
  return r;
}
