// The admin console's "Webhooks" tab (owners/admins of a team workspace; checked by every route):
//   GET    /api/workspaces/:id/admin/webhooks                                list
//   POST   /api/workspaces/:id/admin/webhooks                                add (answers the secret, once)
//   PATCH  /api/workspaces/:id/admin/webhooks/:hookId                        change URL, events, format, on/off
//   POST   /api/workspaces/:id/admin/webhooks/:hookId/rotate                 new secret (answered once)
//   DELETE /api/workspaces/:id/admin/webhooks/:hookId                        remove
//   POST   /api/workspaces/:id/admin/webhooks/:hookId/test                   send a test delivery
//   GET    /api/workspaces/:id/admin/webhooks/:hookId/deliveries             the delivery log
//   POST   /api/workspaces/:id/admin/webhooks/:hookId/deliveries/:d/redeliver
import { Router } from 'express';
import type { WebhookDeliveriesResponse, WebhookEndpointInfo, WebhookSecretResponse, WebhooksAdminResponse } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { currentUser, requireUser } from '../auth/index';
import * as webhooks from './service';

const BASE = '/workspaces/:id/admin/webhooks';

export default function webhookRoutes(_ctx: ServerContext): Router {
  const r = Router();
  const body = (b: unknown) => (b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : {});
  r.get(
    BASE,
    requireUser,
    handle(async (req, res) => res.json({ endpoints: await webhooks.listEndpoints(req.params.id, currentUser(req).id) } satisfies WebhooksAdminResponse)),
  );
  r.post(
    BASE,
    requireUser,
    handle(async (req, res) => res.status(201).json((await webhooks.createEndpoint(req.params.id, currentUser(req).id, body(req.body))) satisfies WebhookSecretResponse)),
  );
  r.patch(
    `${BASE}/:hookId`,
    requireUser,
    handle(async (req, res) => res.json({ endpoint: await webhooks.updateEndpoint(req.params.id, currentUser(req).id, req.params.hookId, body(req.body)) } satisfies { endpoint: WebhookEndpointInfo })),
  );
  r.post(
    `${BASE}/:hookId/rotate`,
    requireUser,
    handle(async (req, res) => res.json((await webhooks.rotateSecret(req.params.id, currentUser(req).id, req.params.hookId)) satisfies WebhookSecretResponse)),
  );
  r.delete(
    `${BASE}/:hookId`,
    requireUser,
    handle(async (req, res) => {
      await webhooks.deleteEndpoint(req.params.id, currentUser(req).id, req.params.hookId);
      res.json({ ok: true });
    }),
  );
  r.post(
    `${BASE}/:hookId/test`,
    requireUser,
    handle(async (req, res) => res.status(202).json({ delivery: await webhooks.testEndpoint(req.params.id, currentUser(req).id, req.params.hookId) })),
  );
  r.get(
    `${BASE}/:hookId/deliveries`,
    requireUser,
    handle(async (req, res) => res.json({ deliveries: await webhooks.listDeliveries(req.params.id, currentUser(req).id, req.params.hookId) } satisfies WebhookDeliveriesResponse)),
  );
  r.post(
    `${BASE}/:hookId/deliveries/:deliveryId/redeliver`,
    requireUser,
    handle(async (req, res) => res.json({ delivery: await webhooks.redeliver(req.params.id, currentUser(req).id, req.params.hookId, req.params.deliveryId) })),
  );
  return r;
}
