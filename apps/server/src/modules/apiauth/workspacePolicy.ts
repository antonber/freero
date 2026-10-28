// A team workspace's API policy (KAI-104, KAI-170 "agents off"): its owners and admins turn API
// access to its boards on or off, see every token and app that reached them, and block one there.
// Checked on every call by credentials.useInWorkspace.
import { isApiScope, type WorkspaceApiInfo } from '@freero/shared';
import { badRequest, notFound } from '../../platform/http';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { requireWorkspace } from '../workspaces/index';
import * as repo from './repo';

async function requireTeamAdmin(workspaceId: string, userId: string): Promise<void> {
  const { workspace } = await requireWorkspace(workspaceId, userId, 'admin');
  if (workspace.kind !== 'team') throw notFound('Workspace not found');
}

async function info(workspaceId: string): Promise<WorkspaceApiInfo> {
  const [enabled, rows] = await Promise.all([repo.workspaceApiEnabled(workspaceId), repo.workspaceCredentials(workspaceId)]);
  const users = await getUsers(rows.map((r) => r.userId));
  return {
    enabled,
    credentials: rows.map((r) => {
      const u = users.get(r.userId);
      return {
        id: r.credentialId,
        kind: r.kind,
        label: r.label,
        user: u ? { id: u.id, name: u.name, email: u.email } : null,
        scopes: r.scopes.filter(isApiScope),
        firstUsedAt: r.firstUsedAt,
        lastUsedAt: r.lastUsedAt,
        blocked: r.blocked,
      };
    }),
  };
}

export async function workspaceApiInfo(workspaceId: string, adminId: string): Promise<WorkspaceApiInfo> {
  await requireTeamAdmin(workspaceId, adminId);
  return info(workspaceId);
}

/** Turns API access for the workspace's boards on or off: the next call is refused (or allowed). */
export async function setWorkspaceApiAccess(workspaceId: string, adminId: string, enabled: unknown): Promise<WorkspaceApiInfo> {
  await requireTeamAdmin(workspaceId, adminId);
  if (typeof enabled !== 'boolean') throw badRequest('enabled must be true or false');
  await repo.transaction(async () => {
    if (await repo.setWorkspaceApiEnabled(workspaceId, enabled, adminId, Date.now()))
      await recordAudit({ action: 'api.access_changed', workspaceId, actorId: adminId, target: { type: 'workspace', id: workspaceId }, metadata: { enabled } });
  });
  return info(workspaceId);
}

/** Blocks (or unblocks) one token or app in this workspace only; it keeps working elsewhere. */
export async function setCredentialBlocked(workspaceId: string, adminId: string, credentialId: string, blocked: boolean): Promise<WorkspaceApiInfo> {
  await requireTeamAdmin(workspaceId, adminId);
  await repo.transaction(async () => {
    const row = await repo.setWorkspaceCredentialBlocked(workspaceId, credentialId, blocked, adminId, Date.now());
    if (!row) throw notFound('No such token or app has used this workspace');
    await recordAudit({
      action: blocked ? 'api.credential_blocked' : 'api.credential_unblocked',
      workspaceId,
      actorId: adminId,
      target: { type: row.kind === 'oauth' ? 'oauth_app' : 'api_token', id: credentialId, label: row.label },
      metadata: { userId: row.userId },
    });
  });
  return info(workspaceId);
}
