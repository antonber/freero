import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { runExclusive } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { requireWorkspaceRole } from '../workspaces/index';
import { EXPORT_LOCK_KEY, listExports, openExport, processExports, requestExport } from './service';

export default function privacyRoutes(_ctx: ServerContext): Router {
  const r = Router();
  // Start building right away on this instance (the scheduled job picks it up otherwise).
  const kick = (req: Parameters<typeof processExports>[0]) =>
    void runExclusive(EXPORT_LOCK_KEY, () => processExports(req)).catch((e) => logError('privacy: export run failed', e));

  r.post('/me/exports', requireUser, rateLimit('dataExport', 'user'), handle(async (req, res) => {
    const e = await requestExport(currentUser(req).id, null);
    kick(req);
    res.status(202).json({ export: e });
  }));
  r.get('/me/exports', requireUser, handle(async (req, res) => {
    res.json({ exports: await listExports({ requestedBy: currentUser(req).id }) });
  }));

  r.post('/workspaces/:id/exports', requireUser, rateLimit('dataExport', 'user'), handle(async (req, res) => {
    const ws = await requireWorkspaceRole(req.params.id, currentUser(req).id, 'admin');
    if (ws.kind !== 'team') throw badRequest('Your personal workspace is part of your own data export (Account settings)');
    const e = await requestExport(currentUser(req).id, ws.id);
    kick(req);
    res.status(202).json({ export: e });
  }));
  r.get('/workspaces/:id/exports', requireUser, handle(async (req, res) => {
    await requireWorkspaceRole(req.params.id, currentUser(req).id, 'admin');
    res.json({ exports: await listExports({ workspaceId: req.params.id }) });
  }));

  r.get('/exports/:id/download', requireUser, handle(async (req, res) => {
    const file = await openExport(req.params.id, currentUser(req).id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    if (file.size !== null) res.setHeader('Content-Length', String(file.size));
    file.body.on('error', () => res.destroy()).pipe(res);
  }));
  return r;
}
