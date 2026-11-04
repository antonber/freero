// The admin console's workspace encryption key (security admins; destroying: owners):
//   GET  /api/workspaces/:id/admin/key           status (and which providers this server offers)
//   POST /api/workspaces/:id/admin/key           turn a key on { kmsKeyId?: AWS KMS key ARN }
//   POST /api/workspaces/:id/admin/key/rotate    rotate { kmsKeyId?: a new ARN, or null for the instance's }
//   POST /api/workspaces/:id/admin/key/suspend   stop opening the workspace's content (reversible)
//   POST /api/workspaces/:id/admin/key/resume    open it again
//   POST /api/workspaces/:id/admin/key/destroy   crypto-shred { confirm: <the workspace's name> }
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { createKey, destroyKey, keyStatus, resumeKey, rotateKey, suspendKey } from './service';

const BASE = '/workspaces/:id/admin/key';

export default function keyRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const body = (b: unknown) => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
  r.get(BASE, requireUser, handle(async (req, res) => res.json(await keyStatus(req.params.id, currentUser(req).id))));
  // Each of these may call the workspace's KMS: limited like other outbound admin actions.
  r.post(BASE, requireUser, rateLimit('sso', 'user'), handle(async (req, res) => res.status(201).json(await createKey(req.params.id, currentUser(req).id, body(req.body)))));
  r.post(`${BASE}/rotate`, requireUser, rateLimit('sso', 'user'), handle(async (req, res) => res.json(await rotateKey(req.params.id, currentUser(req).id, body(req.body)))));
  r.post(`${BASE}/suspend`, requireUser, handle(async (req, res) => res.json(await suspendKey(req.params.id, currentUser(req).id))));
  r.post(`${BASE}/resume`, requireUser, rateLimit('sso', 'user'), handle(async (req, res) => res.json(await resumeKey(req.params.id, currentUser(req).id))));
  r.post(`${BASE}/destroy`, requireUser, handle(async (req, res) => res.json(await destroyKey(req.params.id, currentUser(req).id, body(req.body)))));
  return r;
}
