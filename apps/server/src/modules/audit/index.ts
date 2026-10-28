// Public API of modules/audit [S2]: the audit log every module writes to (KAI-48).
//
//   await recordAudit({ action: 'member.role_changed', workspaceId, target: { type: 'user', id, label: email },
//                       metadata: { from, to } });
//
// Actor, IP and user agent come from the request being handled. Call it where the change is made,
// inside the change's transaction when there is one (they then commit together). An account's own
// events pass `accountId` instead of (or besides) `workspaceId`. A new kind of event adds its
// action to AUDIT_ACTIONS in @freero/shared. Reading the log is the admin console's job
// (modules/admin), always scoped to one workspace.
export {
  recordAudit,
  recordAuditQuietly,
  listAuditEvents,
  verifyWorkspaceAudit,
  type AuditInput,
  type StoredEvent as StoredAuditEvent,
  type EventFilter as AuditFilter,
} from './service';
