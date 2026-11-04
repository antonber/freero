// Tracker sync routes (contract: @freero/shared trackers.ts). Board actions need edit access and
// a connection the person may use; connection management needs its owner or a team's admin
// (connections.ts); webhooks are authenticated only by their signature.
import { Router } from 'express';
import type { BoardTrackersResponse, TrackerProviderKind } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { getConfig } from '../../platform/config';
import { handle } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { rateLimit } from '../../platform/rateLimit';
import { allowCrossSitePost } from '../../platform/security';
import { currentUser, requireUser } from '../auth/index';
import { createConnection, deleteConnectionRecord, listManaged, requireManaged, rotateWebhookSecret, testConnection, info, trackerFieldsOf, updateConnection } from './connections';
import { finishOAuth, oauthOffered, startOAuth } from './oauth';
import * as repo from './repo';
import { dropWebhooks, ensureWebhooks } from './hooks';
import { boardConnections, importIssues, issueTypesOf, markDisconnected, previewSend, projectsOf, receiveWebhook, requestSync, resyncConnection, sendToTracker, sprintsOf, unlink, webhookAddressPending } from './service';

// Trackers post webhooks from their own servers: no browser, no cookie — the signature over the
// body with the connection's secret is the only credential (service.receiveWebhook); Azure DevOps,
// which can't sign, sends the secret as its basic auth password; for webhooks Freero registers
// itself (Asana, monday.com) the address carries a key made with the secret (hooks.ts).
allowCrossSitePost(/^\/api\/trackers\/webhooks\/[^/]+$/, 'tracker webhooks are posted by the tracker’s servers and verified by their HMAC signature (or the secret, for Azure DevOps service hooks; or the address’s key, for webhooks Freero registered)');

const origin = (req: Parameters<typeof appUrl>[0]) => appUrl(req, '');
const providerParam = (p: string): TrackerProviderKind => (p === 'asana' || p === 'monday' || p === 'clickup' ? p : 'jira');

/** Trello (#181): the operator's API key (public by design) and where a person gets a token for it. */
function trelloOffer() {
  const t = getConfig().trackers;
  if (!t.trelloKey) return { key: null, authorizeUrl: null };
  const q = new URLSearchParams({ expiration: 'never', name: 'Freero', scope: 'read,write', response_type: 'token', key: t.trelloKey });
  return { key: t.trelloKey, authorizeUrl: `${t.trelloUrl}/1/authorize?${q}` };
}

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
  r.get(
    '/boards/:id/trackers/connections/:conn/sprints',
    requireUser,
    handle(async (req, res) => {
      res.json(await sprintsOf(currentUser(req).id, req.params.conn, req.params.id, req.query.project));
    }),
  );
  r.get(
    '/boards/:id/trackers/connections/:conn/issue-types',
    requireUser,
    handle(async (req, res) => {
      res.json(await issueTypesOf(currentUser(req).id, req.params.conn, req.params.id, req.query.project));
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
        oauth: { jira: oauthOffered('jira'), asana: oauthOffered('asana'), monday: oauthOffered('monday'), clickup: oauthOffered('clickup') },
        trello: trelloOffer(),
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
      const before = await repo.getConnection(req.params.id);
      const connection = await updateConnection(req.params.id, currentUser(req).id, req.body, req);
      if (connection.status === 'active') await resyncConnection(connection.id);
      // Webhooks Freero registered itself stop with polling, and come back with webhooks.
      const after = await repo.getConnection(connection.id);
      if (before && after && before.inbound !== after.inbound) {
        const hooks = await repo.hooksOfConnection(after.id);
        if (after.inbound === 'polling') await dropWebhooks(after, hooks, 'The connection polls instead.');
        else
          for (const h of hooks) await ensureWebhooks(after, [h.project], h.appOrigin);
      }
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
  r.get(
    '/trackers/connections/:id/fields',
    requireUser,
    rateLimit('trackerSend', 'user'),
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      res.json({ fields: await trackerFieldsOf(req.params.id, currentUser(req).id) });
    }),
  );
  r.post(
    '/trackers/connections/:id/webhook-secret',

    requireUser,
    handle(async (req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      const webhookSecret = await rotateWebhookSecret(req.params.id, currentUser(req).id);
      // The addresses Freero registered carry a key made with the old secret: register them again.
      const conn = await repo.getConnection(req.params.id);
      if (conn) {
        const hooks = await repo.hooksOfConnection(conn.id);
        if (hooks.length) {
          await dropWebhooks(conn, hooks, 'The webhook secret changed.');
          for (const h of hooks) await ensureWebhooks(conn, [h.project], h.appOrigin);
        }
      }
      res.json({ webhookSecret });
    }),
  );
  r.delete(
    '/trackers/connections/:id',
    requireUser,
    handle(async (req, res) => {
      const { connection, links, hooks } = await deleteConnectionRecord(req.params.id, currentUser(req).id);
      // Sync stopped with the delete; the badges say so, board items stay as they are, and the
      // tracker stops posting (webhooks Freero registered there).
      void markDisconnected(connection, links);
      void dropWebhooks(connection, hooks, 'The connection was removed.');
      res.json({ ok: true });
    }),
  );

  // ---- OAuth (Jira Cloud, Asana, monday.com) ----

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

  // Trello asks with a HEAD request whether an address takes deliveries before it makes a webhook:
  // yes only for an address Freero made (its key verifies) while Freero is registering it.
  r.head(
    '/trackers/webhooks/:id',
    handle(async (req, res) => {
      res.status((await webhookAddressPending(req.params.id, req.query as Record<string, unknown>)) ? 200 : 401).end();
    }),
  );
  r.post(
    '/trackers/webhooks/:id',
    handle(async (req, res) => {
      const out = await receiveWebhook(req.params.id, req);
      if (!out.reply) return void res.status(202).json(out);
      // A handshake: Asana wants its X-Hook-Secret back, monday.com its challenge.
      for (const [k, v] of Object.entries(out.reply.headers ?? {})) res.setHeader(k, v);
      if (out.reply.body === undefined) res.status(200).end();
      else res.status(200).json(out.reply.body);
    }),
  );
  return r;
}
