// Public API of modules/siem [S2]: a team workspace's audit log streamed to its SIEM (#17) —
// sinks its admins add (routes.ts, the admin console), fed from modules/audit in chain order by the
// delivery job (init.ts). Nothing else needs to call it today.
export { deliverDueSinks } from './service';
