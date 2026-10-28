// Tracker sync routes (contract: @freero/shared trackers.ts). Board actions need edit access and
// a connection the person may use; connection management needs its owner or a team's admin
// (connections.ts); webhooks are authenticated only by their signature.
import { Router } from 'express';
import type { BoardTrackersResponse, TrackerProviderKind } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { rateLimit } from '../../platform/rateLimit';
import { allowCrossSitePost } from '../../platform/security';
import { currentUser, requireUser } from '../auth/index';
import { createConnection, deleteConnectionRecord, listManaged, requireManaged, rotateWebhookSecret, testConnection, info, updateConnection } from './connections';
import { finishOAuth, oauthOffered, startOAuth } from './oauth';
import * as repo from './repo';
import { boardConnections, importIssues, markDisconnected, previewSend, projectsOf, receiveWebhook, requestSync, resyncConnection, sendToTracker, unlink } from './service';

// Trackers post webhooks from their own servers: no browser, no cookie — the signature over the
// body with the connection's secret is the only credential (service.receiveWebhook).
allowCrossSitePost(/^\/api\/trackers\/webhooks\/[^/]+$/, 'tracker webhooks are posted by the tracker’s servers and verified by their HMAC signature');

const origin = (req: Parameters<typeof appUrl>[0]) => appUrl(req, '');
const providerParam = (p: string): TrackerProviderKind => (p === 'jira' || p === 'linear' || p === 'github' ? p : 'jira');

export default function trackerRoutes(_ctx: ServerContext): Router {
  const r = Router();

  // ---- on a board ----

  r.get(
    '/boards/:id/trackers',
    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({
        connections: await boardConnections(currentUser(req).id, req.params.id),
      } satisfies BoardTrackersResponse);
    }),
  );
  r.get(
    '/boards/:id/trackers/connections/:conn/projects',
    requireUser,
    handle(async (req, res) => {
      res.json(await projectsOf(currentUser(req).id, req.params.conn, req.params.id));
    }),
  );
  r.post(
    '/boards/:id/trackers/preview',
    requireUser,
    handle(async (req, res) => {
      res.json({
        issues: await previewSend(currentUser(req).id, req.params.id, req.body ?? {}, origin(req)),
      });
    }),
  );
  r.post(
    '/boards/:id/trackers/send',
    requireUser,
    handle(async (req, res) => {
      res.status(201).json(await sendToTracker(currentUser(req).id, req.params.id, req.body ?? {}, origin(req)));
    }),
  );
  r.post(
    '/boards/:id/trackers/import',
    requireUser,
    handle(async (req, res) => {
      res.status(201).json(await importIssues(currentUser(req).id, req.params.id, req.body ?? {}, origin(req)));
    }),
  );
  r.post(
    '/boards/:id/trackers/links/:link/sync',
    requireUser,
    handle(async (req, res) => {
      await requestSync(currentUser(req).id, req.params.id, req.params.link);
      res.json({ ok: true });
    }),
  );
  r.delete(
    '/boards/:id/trackers/links/:link',
    requireUser,
    handle(async (req, res) => {
      await unlink(currentUser(req).id, req.params.id, req.params.link);
      res.json({ ok: true });
    }),
  );

  // ---- connections (a team's: its admins; personal: their owner) ----

  r.get(
    '/trackers/connections',
    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const workspaceId = typeof req.query.workspace === 'string' && req.query.workspace ? req.query.workspace : null;
      res.json({
        connections: await listManaged(currentUser(req).id, workspaceId, req),
        oauth: { jira: oauthOffered('jira') },
      });
    }),
  );
  r.post(
    '/trackers/connections',
    requireUser,
    rateLimit('trackerSend', 'user'),
    handle(async (req, res) => {
      res.status(201).json(await createConnection(currentUser(req).id, req.body, req));
    }),
  );
  r.patch(
    '/trackers/connections/:id',
    requireUser,
    handle(async (req, res) => {
      const connection = await updateConnection(req.params.id, currentUser(req).id, req.body, req);
      if (connection.status === 'active') await resyncConnection(connection.id);
      res.json({ connection });
    }),
  );
  r.post(
    '/trackers/connections/:id/test',
    requireUser,
    rateLimit('trackerSend', 'user'),
    handle(async (req, res) => {
      const c = await testConnection(await requireManaged(req.params.id, currentUser(req).id));
      await resyncConnection(c.id);
      res.json({
        ok: true,
        account: c.settings.account ?? null,
        connection: info(c, (await repo.countLinks([c.id])).get(c.id) ?? 0, req, true),
      });
    }),
  );
  r.post(
    '/trackers/connections/:id/webhook-secret',
    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        webhookSecret: await rotateWebhookSecret(req.params.id, currentUser(req).id),
      });
    }),
  );
  r.delete(
    '/trackers/connections/:id',
    requireUser,
    handle(async (req, res) => {
      const { connection, links } = await deleteConnectionRecord(req.params.id, currentUser(req).id);
      // Sync stopped with the delete; the badges say so, board items stay as they are.
      void markDisconnected(connection, links);
      res.json({ ok: true });
    }),
  );

  // ---- OAuth (Jira Cloud) ----

  r.get(
    '/trackers/oauth/:provider/start',
    requireUser,
    rateLimit('oidc', 'ip'),
    handle(async (req, res) => startOAuth(req, res, currentUser(req).id, providerParam(req.params.provider))),
  );
  r.get(
    '/trackers/oauth/:provider/callback',
    requireUser,
    rateLimit('oidc', 'ip'),
    handle(async (req, res) => finishOAuth(req, res, currentUser(req).id, providerParam(req.params.provider))),
  );

  // ---- webhooks ----

  r.post(
    '/trackers/webhooks/:id',
    handle(async (req, res) => {
      res.status(202).json(await receiveWebhook(req.params.id, req));
    }),
  );
  return r;
}
