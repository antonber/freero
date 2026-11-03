// Public API of modules/admin [S2]: the admin console of team workspaces (routes.ts). It owns no
// tables; nothing else needs it today besides the role check other admin features would share.
export { requireAdmin } from './service';
// Audit events as the console shows them (actors' current names): SIEM streams send the same (modules/siem).
export { toAuditEvents } from './service';
