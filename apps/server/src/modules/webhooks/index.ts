// Public API of modules/webhooks [S2]: workspace webhooks (KAI-105) — endpoints a team's admins
// register (routes.ts, the admin console), fed by the event stream (modules/events) through the
// outbox, delivered signed with retries (init.ts). Nothing else needs to call it today.
export { fanOut, deliverDue, signature, webhooksConsumer } from './service';
