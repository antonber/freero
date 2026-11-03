import { Router } from 'express';
import type { SavedTemplate, SavedTemplateSummary } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentUser, requireUser } from '../auth/index';
import { requireAdmin } from '../admin/index';
import { deleteTemplate, getTemplate, listTemplates, placeTemplates, publishTemplate, saveTemplate, setTemplateAdminState, shareTemplate } from './service';

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
      const body = (req.body ?? {}) as Record<string, unknown>;
      // #155: `organisationId` publishes to (or withdraws from) an organisation; `workspaceId` shares with a team.
      if ('organisationId' in body) return void res.json({ template: await publishTemplate(req.params.id, currentUser(req).id, body.organisationId) } satisfies Out);
      res.json({ template: await shareTemplate(req.params.id, currentUser(req).id, body.workspaceId) } satisfies Out);
    }),
  );

  // #155: owners and content admins of where it is shared or published.
  r.post(
    '/templates/:id/lock',
    handle(async (req, res) => {
      res.json({ template: await setTemplateAdminState(req.params.id, currentUser(req).id, { locked: req.body?.locked }) } satisfies Out);
    }),
  );
  r.post(
    '/templates/:id/retire',
    handle(async (req, res) => {
      res.json({ template: await setTemplateAdminState(req.params.id, currentUser(req).id, { retired: req.body?.retired }) } satisfies Out);
    }),
  );
  r.get(
    '/workspaces/:id/admin/templates',
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, { organisation: true, scope: 'content' });
      res.json({ templates: await placeTemplates(req.params.id, currentUser(req).id) } satisfies Out);
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
