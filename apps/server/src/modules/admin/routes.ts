// Admin console routes (contract: @freero/shared api.ts "Admin console"). Every route checks on the
// server that the caller is an owner or admin of that team workspace (requireAdmin).
import { Router, type Request } from 'express';
import type { AdminMember, AuditEvent, AuditIntegrity, WorkspaceSettings, WorkspaceUsage } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { recordAudit, verifyWorkspaceAudit } from '../audit/index';
import { currentUser, requireUser } from '../auth/index';
import { getWorkspaceSettings, setMemberDeactivated, updateWorkspaceSettings } from '../workspaces/index';
import { adminMembers, auditBatches, auditFilter, auditPage, CSV_COLUMNS, csvRow, requireAdmin, workspaceUsage } from './service';

const MAX_PAGE = 200;

const pageSize = (req: Request) => {
  const n = Number(req.query.limit ?? 50);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGE) : 50;
};

export default function adminRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const base = '/workspaces/:id';
  r.use(`${base}/admin`, requireUser);
  r.use(`${base}/audit`, requireUser);

  r.get(
    `${base}/admin/usage`,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id);
      res.json({ usage: (await workspaceUsage(req.params.id)) satisfies WorkspaceUsage });
    }),
  );

  r.get(
    `${base}/admin/members`,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id);
      const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 200) : '';
      res.json({ members: (await adminMembers(req.params.id, q)) satisfies AdminMember[] });
    }),
  );

  for (const [verb, deactivated] of [
    ['deactivate', true],
    ['reactivate', false],
  ] as const) {
    r.post(
      `${base}/admin/members/:userId/${verb}`,
      handle(async (req, res) => {
        const me = currentUser(req).id;
        await requireAdmin(req.params.id, me);
        await setMemberDeactivated(req.params.id, me, req.params.userId, deactivated);
        const member = (await adminMembers(req.params.id)).find((m) => m.userId === req.params.userId);
        if (!member) throw notFound('That person is not a member of this workspace');
        res.json({ member });
      }),
    );
  }

  r.get(
    `${base}/admin/settings`,
    handle(async (req, res) => {
      res.json({ settings: (await getWorkspaceSettings(req.params.id, currentUser(req).id)) satisfies WorkspaceSettings });
    }),
  );

  r.patch(
    `${base}/admin/settings`,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body !== 'object' || Array.isArray(body)) throw badRequest('Send the settings to change as an object');
      res.json({ settings: (await updateWorkspaceSettings(req.params.id, currentUser(req).id, body)) satisfies WorkspaceSettings });
    }),
  );

  // ---- audit log ----

  r.get(
    `${base}/audit`,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id);
      const page: { events: AuditEvent[]; next: string | null } = await auditPage(auditFilter(req.params.id, req.query), pageSize(req));
      res.json(page);
    }),
  );

  r.get(
    `${base}/audit/integrity`,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id);
      res.json({ integrity: (await verifyWorkspaceAudit(req.params.id)) satisfies AuditIntegrity });
    }),
  );

  // The export is itself audited (who took the log out, with which filters). Streamed in batches.
  r.get(
    `${base}/audit/export`,
    rateLimit('auditExport', 'user'),
    handle(async (req, res) => {
      const { name } = await requireAdmin(req.params.id, currentUser(req).id);
      const format = req.query.format === 'json' ? 'json' : req.query.format === 'csv' || req.query.format === undefined ? 'csv' : null;
      if (!format) throw badRequest('format must be csv or json');
      const filter = auditFilter(req.params.id, req.query);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
      const stamp = new Date().toISOString().slice(0, 10);
      // Recorded first: no record, no export.
      await recordAudit({
        action: 'audit.exported',
        actorId: currentUser(req).id,
        workspaceId: req.params.id,
        target: { type: 'workspace', id: req.params.id, label: name },
        metadata: {
          format,
          actions: filter.actions ?? null,
          actor: filter.actorId ?? null,
          target: filter.targetId ?? null,
          from: filter.from ?? null,
          to: filter.to ?? null,
        },
      });
      res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="freero-audit-${slug}-${stamp}.${format}"`);
      res.setHeader('Cache-Control', 'private, no-store');
      let count = 0;
      if (format === 'csv') res.write(`${CSV_COLUMNS.join(',')}\n`);
      else res.write('[');
      try {
        for await (const batch of auditBatches(filter)) {
          for (const e of batch) {
            res.write(format === 'csv' ? `${csvRow(e)}\n` : `${count ? ',' : ''}\n${JSON.stringify(e)}`);
            count++;
          }
        }
      } catch (e) {
        res.destroy(e as Error); // a cut-off file must not look complete
        throw e;
      }
      if (format === 'json') res.write('\n]\n');
      res.end();
    }),
  );

  return r;
}
