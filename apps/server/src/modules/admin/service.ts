// The admin console of a team workspace (KAI-47): members, usage, security / retention settings
// and the audit log. Owns no tables: it composes the owning modules' functions, and every entry
// point checks first that the caller is an owner or admin of the workspace (requireAdmin).
import {
  AUDIT_ACTIONS,
  type AdminMember,
  type AuditAction,
  type AuditEvent,
  type WorkspaceRole,
  type WorkspaceUsage,
} from '@freero/shared';
import { badRequest } from '../../platform/http';
import { listAuditEvents, type AuditFilter, type StoredAuditEvent } from '../audit/index';
import { getUsers, securityStatusOf } from '../auth/index';
import { boardIdsInWorkspace, workspaceBoardStats } from '../boards/index';
import { storedBoardContent } from '../realtime/index';
import { uploadBytesOf } from '../uploads/index';
import { requireWorkspace, workspaceAdminFacts } from '../workspaces/index';

/** 404 unless the caller is in the workspace, 403 unless an owner/admin, 400 for a personal workspace. */
export async function requireAdmin(workspaceId: string, userId: string): Promise<{ name: string }> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin');
  if (workspace.kind !== 'team') throw badRequest('Your personal workspace has no admin console');
  return { name: workspace.name };
}

// ---- members ----

/** Every member with what an admin needs to judge them (two-step, last activity, boards); `q` filters by name or email. */
export async function adminMembers(workspaceId: string, q = ''): Promise<AdminMember[]> {
  const facts = await workspaceAdminFacts(workspaceId);
  const ids = facts.members.map((m) => m.userId);
  const [users, security, stats] = await Promise.all([getUsers(ids), securityStatusOf(ids), workspaceBoardStats(workspaceId)]);
  const needle = q.trim().toLowerCase();
  const out: AdminMember[] = [];
  for (const m of facts.members) {
    const u = users.get(m.userId);
    if (!u) continue;
    if (needle && !u.name.toLowerCase().includes(needle) && !u.email.toLowerCase().includes(needle)) continue;
    out.push({
      userId: u.id,
      name: u.name,
      email: u.email,
      color: u.color,
      avatarUrl: u.avatarUrl,
      role: m.role,
      joinedAt: m.joinedAt,
      deactivated: m.deactivated,
      twoFactor: security.twoFactor.has(u.id),
      lastActiveAt: security.lastActive.get(u.id) ?? null,
      boards: stats.ownedBy.get(u.id) ?? 0,
    });
  }
  return out;
}

// ---- usage ----

export async function workspaceUsage(workspaceId: string): Promise<WorkspaceUsage> {
  const [facts, stats, boardIds] = await Promise.all([workspaceAdminFacts(workspaceId), workspaceBoardStats(workspaceId), boardIdsInWorkspace(workspaceId)]);
  const content = await storedBoardContent(boardIds);
  const members: Record<WorkspaceRole, number> = { owner: 0, admin: 0, member: 0, guest: 0 };
  for (const m of facts.members) members[m.role]++;
  return {
    boards: stats.live,
    trashedBoards: stats.trashed,
    projects: facts.projects,
    members,
    deactivated: facts.members.filter((m) => m.deactivated).length,
    pendingInvites: facts.pendingInvites,
    activeUsers7d: stats.active7d,
    activeUsers30d: stats.active30d,
    contentBytes: content.bytes,
    fileBytes: await uploadBytesOf(content.uploadNames),
  };
}

// ---- audit log ----

const ACTION_RE = /^[a-z_]+(\.[a-z_]+)*\.?$/;

/** Parses the audit filters of a query string (the same for the list and the export). */
export function auditFilter(workspaceId: string, q: Record<string, unknown>): AuditFilter {
  const str = (k: string) => (typeof q[k] === 'string' && q[k] ? (q[k] as string) : undefined);
  const time = (k: string) => {
    const v = str(k);
    if (v === undefined) return undefined;
    const n = Number(v);
    if (!Number.isFinite(n)) throw badRequest(`${k} must be a time in epoch milliseconds`);
    return n;
  };
  const actions = str('action')?.split(',').map((a) => a.trim()).filter(Boolean);
  for (const a of actions ?? []) if (!ACTION_RE.test(a) || a.length > 80) throw badRequest(`Unknown action filter ${a}`);
  const before = str('before');
  if (before !== undefined && !/^\d{1,19}$/.test(before)) throw badRequest('before must be an event id');
  return { workspaceId, actions, actorId: str('actor'), targetId: str('target'), from: time('from'), to: time('to'), beforeId: before };
}

/** Stored events as the API shows them, with the actors' current names (null actor: Freero / nobody signed in). */
export async function toAuditEvents(events: StoredAuditEvent[]): Promise<AuditEvent[]> {
  const users = await getUsers(events.flatMap((e) => (e.actorId ? [e.actorId] : [])));
  return events.map((e) => {
    const u = e.actorId ? users.get(e.actorId) : undefined;
    return {
      id: e.id,
      at: e.createdAt,
      action: e.action as AuditAction,
      workspaceId: e.workspaceId,
      actor: e.actorId ? { id: e.actorId, name: u?.name ?? 'Deleted user', email: u?.email ?? null } : null,
      target: e.targetType && e.targetId ? { type: e.targetType, id: e.targetId, label: e.targetLabel } : null,
      ip: e.ip,
      userAgent: e.userAgent,
      metadata: e.metadata,
      chain: e.chain,
      seq: e.seq,
      prevHash: e.prevHash,
      hash: e.hash,
    };
  });
}

export async function auditPage(filter: AuditFilter, limit: number): Promise<{ events: AuditEvent[]; next: string | null }> {
  const rows = await listAuditEvents(filter, limit + 1);
  const page = rows.slice(0, limit);
  return { events: await toAuditEvents(page), next: rows.length > limit ? page[page.length - 1].id : null };
}

export const EXPORT_BATCH = 1000;
/** An export stops after this many events (narrow the dates for more). */
export const EXPORT_MAX = 100_000;

/** Pages through every event the filter matches, newest first, EXPORT_BATCH at a time. */
export async function* auditBatches(filter: AuditFilter): AsyncGenerator<AuditEvent[]> {
  let beforeId = filter.beforeId;
  for (let total = 0; total < EXPORT_MAX; ) {
    const rows = await listAuditEvents({ ...filter, beforeId }, Math.min(EXPORT_BATCH, EXPORT_MAX - total));
    if (!rows.length) return;
    yield await toAuditEvents(rows);
    total += rows.length;
    if (rows.length < EXPORT_BATCH) return;
    beforeId = rows[rows.length - 1].id;
  }
}

export const CSV_COLUMNS = [
  'id',
  'time',
  'action',
  'description',
  'actor_id',
  'actor_name',
  'actor_email',
  'target_type',
  'target_id',
  'target_label',
  'ip',
  'user_agent',
  'metadata',
  'chain',
  'seq',
  'prev_hash',
  'hash',
] as const;

/**
 * One CSV field: quoted when needed, and a leading = + - @ (or tab / CR) neutralised so a
 * spreadsheet never runs what someone typed into a board title or name as a formula.
 */
export function csvField(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'string' ? v : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvRow(e: AuditEvent): string {
  return [
    e.id,
    new Date(e.at).toISOString(),
    e.action,
    AUDIT_ACTIONS[e.action] ?? e.action,
    e.actor?.id,
    e.actor?.name,
    e.actor?.email,
    e.target?.type,
    e.target?.id,
    e.target?.label,
    e.ip,
    e.userAgent,
    JSON.stringify(e.metadata),
    e.chain,
    e.seq,
    e.prevHash,
    e.hash,
  ]
    .map(csvField)
    .join(',');
}
