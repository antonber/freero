// The sensitive-data scan (#158; contract: @freero/shared compliance.ts):
//   GET /api/workspaces/:id/admin/sensitive-data   settings and findings (content admins)
//   PUT /api/workspaces/:id/admin/sensitive-data   change the settings (content admins)
//   GET /api/boards/:id/sensitive-data             what the board's managers see on the board
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { currentUser, requireUser } from '../auth/index';
import { boardSensitiveData, sensitiveDataStatus, updateSensitiveDataSettings } from './service';

export default function dlpRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const body = (b: unknown) => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
  r.get('/workspaces/:id/admin/sensitive-data', requireUser, handle(async (req, res) => res.json(await sensitiveDataStatus(req.params.id, currentUser(req).id))));
  r.put('/workspaces/:id/admin/sensitive-data', requireUser, handle(async (req, res) => res.json(await updateSensitiveDataSettings(req.params.id, currentUser(req).id, body(req.body)))));
  r.get('/boards/:id/sensitive-data', requireUser, handle(async (req, res) => res.json(await boardSensitiveData(req.params.id, currentUser(req).id))));
  return r;
}
