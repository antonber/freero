// Public API of modules/webhooks [S2]: workspace webhooks (KAI-105) — endpoints a team's admins
// register (routes.ts, the admin console), fed by the event stream (modules/events) through the
// outbox, delivered signed with retries (init.ts). Nothing else needs to call it today.
export { fanOut, deliverDue, signature, webhooksConsumer } from './service';
// The same management for the public API (#48, modules/api: owners/admins with webhooks:manage) —
// each function checks the person is an owner or admin of the workspace — and the workspace data
// export's webhook configuration (modules/privacy; never secrets).
export {
  listEndpoints as listWebhooks,
  createEndpoint as createWebhook,
  updateEndpoint as updateWebhook,
  rotateSecret as rotateWebhookSecret,
  deleteEndpoint as deleteWebhook,
  testEndpoint as testWebhook,
  listDeliveries as webhookDeliveries,
  redeliver as redeliverWebhook,
  webhooksWorkspaceExportOf,
} from './service';
