// What modules/workspaces holds, for data exports (modules/privacy): a person's memberships, and a
// whole team workspace's directory (members, invitations, projects) for its admins.
import type { WorkspacePolicies, WorkspaceRole } from '@freero/shared';
import { getUsers } from '../auth/index';
import * as repo from './repo';

const iso = (ms: number) => new Date(ms).toISOString();

export interface MembershipExport {
  workspaceId: string;
  workspace: string;
  kind: 'personal' | 'team';
  role: WorkspaceRole;
  projects: Array<{ id: string; name: string }>;
}

/** Every workspace the person is in, their role and the projects they were added to. */
export async function exportMembershipsOf(userId: string): Promise<MembershipExport[]> {
  const rows = await repo.workspacesOf(userId);
  const ids = rows.map((r) => r.workspace.id);
  const [projects, mine] = await Promise.all([repo.projectsIn(ids), repo.projectIdsOf(userId, ids)]);
  return rows.map((r) => ({
    workspaceId: r.workspace.id,
    workspace: r.workspace.name,
    kind: r.workspace.kind,
    role: r.role,
    projects: projects.filter((p) => p.workspaceId === r.workspace.id && mine.has(p.id)).map((p) => ({ id: p.id, name: p.name })),
  }));
}

export interface WorkspaceDirectoryExport {
  workspace: { id: string; name: string; kind: 'personal' | 'team'; policies: WorkspacePolicies; createdAt: string };
  members: Array<{ userId: string; name: string; email: string; role: WorkspaceRole; joinedAt: string }>;
  invitations: Array<{ email: string; role: string; invitedBy: string; createdAt: string; expiresAt: string }>;
  projects: Array<{ id: string; name: string; access: string; createdAt: string; memberIds: string[] }>;
}

export async function exportWorkspaceDirectory(workspaceId: string): Promise<WorkspaceDirectoryExport | null> {
  const ws = await repo.getWorkspace(workspaceId);
  if (!ws) return null;
  const [members, invites, projects] = await Promise.all([repo.listMembers(workspaceId), repo.listInvites(workspaceId), repo.projectsIn([workspaceId])]);
  const users = await getUsers(members.map((m) => m.userId));
  return {
    workspace: { id: ws.id, name: ws.name, kind: ws.kind, policies: ws.policies, createdAt: iso(ws.createdAt) },
    members: members.flatMap((m) => {
      const u = users.get(m.userId);
      return u ? [{ userId: u.id, name: u.name, email: u.email, role: m.role, joinedAt: iso(m.createdAt) }] : [];
    }),
    invitations: invites.map((i) => ({ email: i.email, role: i.role, invitedBy: i.invitedBy, createdAt: iso(i.createdAt), expiresAt: iso(i.expiresAt) })),
    projects: await Promise.all(
      projects.map(async (p) => ({ id: p.id, name: p.name, access: p.access, createdAt: iso(p.createdAt), memberIds: await repo.projectMemberIds(p.id) })),
    ),
  };
}
