// What a workspace's owners/admins manage in the app: provisioning tokens (generated here, shown
// once, stored as sha256; rotate by creating a new one and revoking the old) and what each
// directory group grants in Freero.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { ScimGroupMapping, ScimSettings } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { audit } from '../../platform/audit';
import { appUrl } from '../../platform/mail';
import { projectOfWorkspace } from '../workspaces/index';
import * as repo from './repo';
import { syncPerson, TOKEN_PREFIX } from './service';

const MAX_TOKENS = 5;

export const scimBaseUrl = (req: Request | null) => `${getConfig().publicUrl ?? appUrl(req, '')}/scim/v2`;

export async function scimSettings(req: Request | null, workspaceId: string): Promise<ScimSettings> {
  const [tokens, groups, members, users] = await Promise.all([
    repo.listTokens(workspaceId),
    repo.listGroups(workspaceId),
    repo.membersByGroup(workspaceId),
    repo.listUsers(workspaceId),
  ]);
  return {
    baseUrl: scimBaseUrl(req),
    tokens: tokens.map((t) => ({ id: t.id, label: t.label, prefix: t.prefix, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt })),
    groups: groups.map((g) => ({ id: g.id, displayName: g.displayName, memberCount: members.get(g.id)?.length ?? 0, mapping: g.mapping })),
    provisioned: { active: users.filter((u) => u.active).length, deactivated: users.filter((u) => !u.active).length },
  };
}

export async function createToken(workspaceId: string, createdBy: string, labelIn: unknown): Promise<string> {
  const label = typeof labelIn === 'string' && labelIn.trim() ? labelIn.trim().slice(0, 80) : 'Provisioning';
  if ((await repo.countTokens(workspaceId)) >= MAX_TOKENS) throw new HttpError(409, `A workspace can have at most ${MAX_TOKENS} provisioning tokens. Revoke one first.`);
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`;
  const id = newId(12);
  await repo.insertToken({
    id,
    workspaceId,
    label,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
    createdBy,
    now: Date.now(),
  });
  await audit({ action: 'scim.token_created', actor: { kind: 'user', userId: createdBy }, userId: createdBy, detail: { workspaceId, tokenId: id, label } });
  return token;
}

export async function revokeToken(workspaceId: string, actorId: string, tokenId: string): Promise<void> {
  if (!(await repo.deleteToken(workspaceId, tokenId))) throw notFound('Token not found');
  await audit({ action: 'scim.token_revoked', actor: { kind: 'user', userId: actorId }, userId: actorId, detail: { workspaceId, tokenId } });
}

function cleanMapping(v: unknown): ScimGroupMapping | null {
  if (v === null || v === undefined) return null;
  const m = v as { kind?: unknown; role?: unknown; projectId?: unknown };
  if (m.kind === 'role' && (m.role === 'admin' || m.role === 'member' || m.role === 'guest')) return { kind: 'role', role: m.role };
  if (m.kind === 'project' && typeof m.projectId === 'string' && m.projectId) return { kind: 'project', projectId: m.projectId };
  throw badRequest('mapping must be null, { kind: "role", role: admin|member|guest } or { kind: "project", projectId }');
}

/** Changes what a group grants, and applies it to its members now. */
export async function mapGroup(workspaceId: string, groupId: string, body: { mapping?: unknown }): Promise<void> {
  const mapping = cleanMapping(body.mapping);
  const g = await repo.getGroup(workspaceId, groupId);
  if (!g) throw notFound('Group not found');
  if (mapping?.kind === 'project' && !(await projectOfWorkspace(mapping.projectId, workspaceId))) throw badRequest('That project is not in this workspace');
  if (!(await repo.setMapping(workspaceId, groupId, mapping, Date.now()))) throw notFound('Group not found');
  const unmapped = g.mapping?.kind === 'project' && (mapping?.kind !== 'project' || mapping.projectId !== g.mapping.projectId) ? [g.mapping.projectId] : [];
  // A role mapping changes everyone's roles (the directory starts or stops owning them).
  const affected = g.mapping?.kind === 'role' || mapping?.kind === 'role' ? (await repo.listUsers(workspaceId)).map((u) => u.userId) : await repo.groupMemberIds(groupId);
  for (const id of affected) await syncPerson(workspaceId, id, unmapped);
}
