import { Router, type Request } from 'express';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { requireWorkspaceRole } from '../workspaces/index';
import { createToken, mapGroup, revokeToken, scimSettings } from './settings';
import { scimRouter } from './protocol';

// Mounted at the root: the admin API lives under /api, the SCIM service under /scim/v2.
export const mountPath = '/';

async function manager(req: Request) {
  const ws = await requireWorkspaceRole(req.params.id, currentUser(req).id, 'admin');
  if (ws.kind !== 'team') throw badRequest('Provisioning is set up for a team workspace');
  return ws;
}

export default function scimRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.get('/api/workspaces/:id/scim', requireUser, handle(async (req, res) => {
    await manager(req);
    res.json(await scimSettings(req, req.params.id));
  }));
  r.post('/api/workspaces/:id/scim/tokens', requireUser, handle(async (req, res) => {
    await manager(req);
    const token = await createToken(req.params.id, currentUser(req).id, req.body?.label);
    res.status(201).json({ token, settings: await scimSettings(req, req.params.id) });
  }));
  r.delete('/api/workspaces/:id/scim/tokens/:tokenId', requireUser, handle(async (req, res) => {
    await manager(req);
    await revokeToken(req.params.id, currentUser(req).id, req.params.tokenId);
    res.json(await scimSettings(req, req.params.id));
  }));
  r.put('/api/workspaces/:id/scim/groups/:groupId', requireUser, handle(async (req, res) => {
    await manager(req);
    await mapGroup(req.params.id, req.params.groupId, req.body ?? {});
    res.json(await scimSettings(req, req.params.id));
  }));
  // Per client IP like /api (tokens are 256-bit; this only caps load), then per token inside.
  r.use('/scim/v2', rateLimit('api'), scimRouter());
  return r;
}
