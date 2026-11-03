// Connects the audit log to the rest of the server, in both processes that write it: the app
// (init.ts) and the operator CLI (admin.ts).
import { DEFAULT_AUDIT_RETENTION_DAYS } from '@freero/shared';
import { onAuditEvent } from '../../platform/audit';
import { boardWorkspaceId } from '../boards/index';
import { auditScopeOf, organisationsOfWorkspaces, retentionOverrides } from '../workspaces/index';
import { pruneAudit, recordPlatformAudit, setAccountScope, setOrganisationScope } from './service';

/**
 * An account's own events also reach its team workspaces, and every attached workspace's events its
 * organisation's log; platform audit events land in the log
 * (one about a board — an operator taking it down — also in that board's workspace log).
 */
export function connectAudit(): () => void {
  setAccountScope(auditScopeOf);
  // An attached workspace's events also reach its organisation's log (#108).
  setOrganisationScope(organisationsOfWorkspaces);
  return onAuditEvent(async (e) => {
    const boardId = e.detail?.boardId;
    const workspaceId = typeof boardId === 'string' && boardId ? await boardWorkspaceId(boardId) : null;
    await recordPlatformAudit(e, workspaceId);
  });
}

/**
 * Retention: each workspace keeps its events for its `auditRetentionDays`; accounts' own logs and
 * deleted workspaces' logs for DEFAULT_AUDIT_RETENTION_DAYS. Idempotent.
 */
export async function pruneAuditByPolicy(now = Date.now()): Promise<number> {
  return pruneAudit(
    async () => new Map((await retentionOverrides()).map((o) => [o.id, o.auditDays])),
    DEFAULT_AUDIT_RETENTION_DAYS,
    now,
  );
}
