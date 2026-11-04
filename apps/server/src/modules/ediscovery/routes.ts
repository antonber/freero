// eDiscovery cases (#157) under a team workspace or an organisation: owners, and admins with both
// the security and content scopes (service.requireCaseManager checks every route).
import { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { runExclusive } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { CASE_EXPORT_LOCK_KEY, changeCase, createCase, getCaseDetail, listCases, openCaseExport, processCaseExports, releaseCase, requestCaseExport } from './service';

export default function ediscoveryRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const base = '/workspaces/:id/legal-cases';
  r.get(base, requireUser, handle(async (req, res) => {
    res.json({ cases: await listCases(req.params.id, currentUser(req).id) });
  }));
  r.post(base, requireUser, handle(async (req, res) => {
    res.status(201).json({ case: await createCase(req.params.id, currentUser(req).id, req.body ?? {}) });
  }));
  r.get(`${base}/:caseId`, requireUser, handle(async (req, res) => {
    res.json({ case: await getCaseDetail(req.params.id, req.params.caseId, currentUser(req).id) });
  }));
  r.patch(`${base}/:caseId`, requireUser, handle(async (req, res) => {
    res.json({ case: await changeCase(req.params.id, req.params.caseId, currentUser(req).id, req.body ?? {}) });
  }));
  r.post(`${base}/:caseId/release`, requireUser, handle(async (req, res) => {
    res.json({ case: await releaseCase(req.params.id, req.params.caseId, currentUser(req).id) });
  }));
  r.post(`${base}/:caseId/exports`, requireUser, rateLimit('dataExport', 'user'), handle(async (req, res) => {
    const e = await requestCaseExport(req.params.id, req.params.caseId, currentUser(req).id);
    // Start building right away on this instance (the scheduled job picks it up otherwise).
    void runExclusive(CASE_EXPORT_LOCK_KEY, () => processCaseExports()).catch((err) => logError('ediscovery: export run failed', err));
    res.status(202).json({ export: e });
  }));
  r.get(`${base}/:caseId/exports/:exportId/download`, requireUser, handle(async (req, res) => {
    const file = await openCaseExport(req.params.id, req.params.caseId, req.params.exportId, currentUser(req).id);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    if (file.size !== null) res.setHeader('Content-Length', String(file.size));
    file.body.on('error', () => res.destroy()).pipe(res);
  }));
  return r;
}
