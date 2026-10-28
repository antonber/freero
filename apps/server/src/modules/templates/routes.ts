import { Router } from 'express';
import type { SavedTemplate, SavedTemplateSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { deleteTemplate, getTemplate, listTemplates, saveTemplate, shareTemplate } from './service';

type Out = { templates: SavedTemplateSummary[] } | { template: SavedTemplateSummary | SavedTemplate } | { ok: true };

export default function templateRoutes(_ctx: ServerContext): Router {
  const r = Router();
  r.use('/templates', requireUser);

  r.get(
    '/templates',
    handle(async (req, res) => {
      res.json({ templates: await listTemplates(currentUser(req).id) } satisfies Out);
    }),
  );

  r.get(
    '/templates/:id',
    handle(async (req, res) => {
      res.json({ template: await getTemplate(req.params.id, currentUser(req).id) } satisfies Out);
    }),
  );

  r.post(
    '/templates',
    rateLimit('templateSave', 'user'),
    handle(async (req, res) => {
      res.status(201).json({ template: await saveTemplate(currentUser(req).id, req.body) } satisfies Out);
    }),
  );

  r.patch(
    '/templates/:id',
    handle(async (req, res) => {
      res.json({ template: await shareTemplate(req.params.id, currentUser(req).id, req.body?.workspaceId) } satisfies Out);
    }),
  );

  r.delete(
    '/templates/:id',
    handle(async (req, res) => {
      await deleteTemplate(req.params.id, currentUser(req).id);
      res.json({ ok: true } satisfies Out);
    }),
  );

  return r;
}
