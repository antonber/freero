// Admin console routes (contract: @freero/shared api.ts "Admin console"). Every route checks on the
// server that the caller is an owner or admin of that team workspace (requireAdmin).
import { Router, type Request } from 'express';
import { USAGE_HISTORY_MAX_DAYS, type UsageDay } from '@freero/shared';
import type { AdminBoardsResponse, AdminMember, AdminTrashedBoard, AuditEvent, AuditIntegrity, LinkComplianceIssue, WorkspaceSettings, WorkspaceUsage } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle, notFound } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { recordAudit, verifyWorkspaceAudit } from '../audit/index';
import { currentUser, getUsers, requireUser } from '../auth/index';
import { linksOutOfPolicy, restoreForWorkspace, transferForWorkspace, turnOffLinkForWorkspace, workspaceBoard, workspaceTrash } from '../boards/index';
import { removeOutsideMembers } from '../members/index';
import { getWorkspaceSettings, setMemberDeactivated, updateWorkspaceSettings } from '../workspaces/index';
import { adminMembers, auditBatches, auditFilter, auditPage, boardInventory, CSV_COLUMNS, csvRow, inventoryQuery, requireAdmin, workspaceUsage } from './service';
import { workspaceAdminFacts } from '../workspaces/index';
import { usageCsv, usageHistory } from './usage';

const MAX_PAGE = 200;
/** Members (with organisation-wide deactivation), settings and the audit log also serve an organisation (#108). */
const ORG = { organisation: true };
// #151: what each route needs (usage and the member list: any admin).
const SECURITY = { organisation: true, scope: 'security' } as const;
const MEMBERS = { organisation: true, scope: 'members' } as const;

const pageSize = (req: Request) => {
  const n = Number(req.query.limit ?? 50);
  return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_PAGE) : 50;
};

export default function adminRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const base = '/workspaces/:id';
  // requireUser on each route, not r.use(`${base}/admin`, …): modules/ai serves under
  // /workspaces/:id/admin too (dune-check S6, KAI-190).

  r.get(
    `${base}/admin/usage`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id);
      res.json({ usage: (await workspaceUsage(req.params.id)) satisfies WorkspaceUsage });
    }),
  );

  // #65: the daily rollups (any admin), as JSON or CSV.
  const historyDays = (req: Request) => {
    const n = Number(req.query.days ?? 90);
    return Number.isInteger(n) && n > 0 ? Math.min(n, USAGE_HISTORY_MAX_DAYS) : 90;
  };
  r.get(
    `${base}/admin/usage/history`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id);
      res.json({ days: (await usageHistory(req.params.id, historyDays(req))) satisfies UsageDay[] });
    }),
  );
  r.get(
    `${base}/admin/usage/history.csv`,
    requireUser,
    handle(async (req, res) => {
      const { name } = await requireAdmin(req.params.id, currentUser(req).id);
      const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="freero-usage-${slug}-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(usageCsv(await usageHistory(req.params.id, historyDays(req))));
    }),
  );

  // Boards whose link is on but doesn't meet the link policy (#39): links from before the policy
  // keep working, so admins see which to ask about.
  r.get(
    `${base}/admin/link-compliance`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, { scope: 'content' });
      const boards = await linksOutOfPolicy(req.params.id);
      const owners = await getUsers(boards.map((b) => b.ownerId));
      res.json({
        boards: boards.map(
          (b): LinkComplianceIssue => ({
            boardId: b.id,
            title: b.title,
            ownerName: owners.get(b.ownerId)?.name ?? 'Unknown',
            linkAccess: b.linkAccess as LinkComplianceIssue['linkAccess'],
            expiresAt: b.expiresAt,
            problems: b.problems,
          }),
        ),
      });
    }),
  );

  // #152: the board inventory (metadata only) and what its content admins fix from it.
  const CONTENT = { scope: 'content' } as const;
  r.get(
    `${base}/admin/boards`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, CONTENT);
      res.json((await boardInventory(req.params.id, inventoryQuery(req.query))) satisfies AdminBoardsResponse);
    }),
  );
  r.post(
    `${base}/admin/boards/:boardId/link-off`,
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req).id;
      await requireAdmin(req.params.id, me, CONTENT);
      await turnOffLinkForWorkspace(req.params.id, req.params.boardId, me);
      res.json({ ok: true });
    }),
  );
  r.post(
    `${base}/admin/boards/:boardId/remove-outsiders`,
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req).id;
      await requireAdmin(req.params.id, me, CONTENT);
      const board = await workspaceBoard(req.params.id, req.params.boardId);
      const inWorkspace = new Set((await workspaceAdminFacts(req.params.id)).members.map((m) => m.userId));
      res.json({ removed: await removeOutsideMembers(board, req.params.id, inWorkspace, me) });
    }),
  );
  r.post(
    `${base}/admin/boards/:boardId/transfer`,
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req).id;
      await requireAdmin(req.params.id, me, CONTENT);
      await transferForWorkspace(req.params.id, req.params.boardId, me, req.body?.userId);
      res.json({ ok: true });
    }),
  );

  // #153: everyone's trash, for the workspace's content admins (metadata only), and restoring from it.
  r.get(
    `${base}/admin/trash`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, { scope: 'content' });
      res.json({ boards: (await workspaceTrash(req.params.id)) satisfies AdminTrashedBoard[] });
    }),
  );
  r.post(
    `${base}/admin/trash/:boardId/restore`,
    requireUser,
    handle(async (req, res) => {
      const me = currentUser(req).id;
      await requireAdmin(req.params.id, me, { scope: 'content' });
      await restoreForWorkspace(req.params.id, req.params.boardId, me);
      res.json({ ok: true });
    }),
  );

  r.get(
    `${base}/admin/members`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, ORG);
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
      requireUser,
      handle(async (req, res) => {
        const me = currentUser(req).id;
        await requireAdmin(req.params.id, me, MEMBERS);
        await setMemberDeactivated(req.params.id, me, req.params.userId, deactivated);
        const member = (await adminMembers(req.params.id)).find((m) => m.userId === req.params.userId);
        if (!member) throw notFound('That person is not a member of this workspace');
        res.json({ member });
      }),
    );
  }

  r.get(
    `${base}/admin/settings`,
    requireUser,
    handle(async (req, res) => {
      res.json({ settings: (await getWorkspaceSettings(req.params.id, currentUser(req).id)) satisfies WorkspaceSettings });
    }),
  );

  r.patch(
    `${base}/admin/settings`,
    requireUser,
    handle(async (req, res) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      if (typeof body !== 'object' || Array.isArray(body)) throw badRequest('Send the settings to change as an object');
      res.json({ settings: (await updateWorkspaceSettings(req.params.id, currentUser(req).id, body)) satisfies WorkspaceSettings });
    }),
  );

  // ---- audit log ----

  r.get(
    `${base}/audit`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, SECURITY);
      const page: { events: AuditEvent[]; next: string | null } = await auditPage(auditFilter(req.params.id, req.query), pageSize(req));
      res.json(page);
    }),
  );

  r.get(
    `${base}/audit/integrity`,
    requireUser,
    handle(async (req, res) => {
      await requireAdmin(req.params.id, currentUser(req).id, SECURITY);
      res.json({ integrity: (await verifyWorkspaceAudit(req.params.id)) satisfies AuditIntegrity });
    }),
  );

  // The export is itself audited (who took the log out, with which filters). Streamed in batches.
  r.get(
    `${base}/audit/export`,
    requireUser,
    rateLimit('auditExport', 'user'),
    handle(async (req, res) => {
      const { name } = await requireAdmin(req.params.id, currentUser(req).id, SECURITY);
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
