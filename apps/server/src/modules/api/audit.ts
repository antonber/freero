// GET /api/v1/workspaces/:workspaceId/audit (#17): a team workspace's audit log for SIEMs that pull,
// in chain order with a cursor (the event's `seq`), for owners/admins with an `audit:read` token.
// The same events, actors and wording as the admin console and the push streams (modules/siem).
import type { AuditEvent } from '@freero/shared';
import { badRequest } from '../../platform/http';
import { requireAdmin, toAuditEvents } from '../admin/index';
import { useInWorkspace } from '../apiauth/index';
import { workspaceEventsAfter, workspaceHeadSeq } from '../audit/index';
import type { ApiCall } from './service';

const MAX = 500;

export async function workspaceAuditFor(
  call: ApiCall,
  workspaceId: string,
  q: { after?: unknown; limit?: unknown },
): Promise<{ events: AuditEvent[]; cursor: string; more: boolean; headSeq: number }> {
  const { name } = await requireAdmin(workspaceId, call.userId);
  await useInWorkspace(call.cred, workspaceId);
  call.audit.workspaceId = workspaceId;
  call.audit.target = { type: 'workspace', id: workspaceId, label: name };
  const after = q.after === undefined || q.after === '' ? 0 : Number(q.after);
  if (!Number.isSafeInteger(after) || after < 0) throw badRequest('after must be the cursor of a previous page (an event seq)');
  const limit = q.limit === undefined ? 100 : Number(q.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX) throw badRequest(`limit must be 1–${MAX}`);
  const [rows, headSeq] = await Promise.all([workspaceEventsAfter(workspaceId, after, limit + 1), workspaceHeadSeq(workspaceId)]);
  const page = rows.slice(0, limit);
  return { events: await toAuditEvents(page), cursor: String(page.at(-1)?.seq ?? after), more: rows.length > limit, headSeq };
}
