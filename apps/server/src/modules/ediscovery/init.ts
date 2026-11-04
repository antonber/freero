// Legal holds reach the jobs that would otherwise delete held data (#157): the audit log keeps the
// chains of open cases' places, workspaces and custodians; an organisation with an open case can't
// be deleted. (Boards, versions, the trash, the account purge and team workspace deletion ask
// boards' own hold rows.) Builds queued case exports and expires old ones.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { onAuditRetentionHold } from '../audit/index';
import { onWorkspaceDeletionHold } from '../workspaces/index';
import { CASE_EXPORT_LOCK_KEY, heldAuditChains, organisationDeletionHold, processCaseExports } from './service';

export default function initEdiscovery(ctx: ServerContext): void {
  const offAudit = onAuditRetentionHold(heldAuditChains);
  const offOrg = onWorkspaceDeletionHold(organisationDeletionHold);
  ctx.onShutdown(async () => {
    offAudit();
    offOrg();
  });
  scheduleExclusiveJob(ctx, {
    name: 'ediscovery:exports',
    lockKey: CASE_EXPORT_LOCK_KEY,
    intervalMs: ctx.config.dataExportIntervalMs,
    run: () => processCaseExports(),
  });
}
