// What a workspace's owners/admins manage in the app: provisioning tokens (generated here, shown
// once, stored as sha256; rotating swaps a token for a new one in one step, or create a second one
// and revoke the first once the directory uses it) and what each directory group grants in Freero.
import { createHash, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import type { ScimGroupMapping, ScimSettings } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { appUrl } from '../../platform/mail';
import { recordAudit } from '../audit/index';
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
  const { token, id } = newToken();
  await repo.transaction(async () => {
    await insertToken(workspaceId, createdBy, id, token, label);
    await recordAudit({ action: 'scim.token_created', workspaceId, actorId: createdBy, target: tokenTarget(id, label) });
  });
  return token;
}

function newToken() {
  return { token: `${TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`, id: newId(12) };
}

const tokenTarget = (id: string, label: string) => ({ type: 'scim_token', id, label });

function insertToken(workspaceId: string, createdBy: string, id: string, token: string, label: string) {
  return repo.insertToken({
    id,
    workspaceId,
    label,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    prefix: token.slice(0, TOKEN_PREFIX.length + 6),
    createdBy,
    now: Date.now(),
  });
}

/** A new token in place of `tokenId` (same label), in one transaction: the old one stops working at once. */
export async function rotateToken(workspaceId: string, actorId: string, tokenId: string): Promise<string> {
  const old = (await repo.listTokens(workspaceId)).find((t) => t.id === tokenId);
  if (!old) throw notFound('Token not found');
  const { token, id } = newToken();
  await repo.transaction(async () => {
    if (!(await repo.deleteToken(workspaceId, tokenId))) throw notFound('Token not found');
    await insertToken(workspaceId, actorId, id, token, old.label);
    await recordAudit({ action: 'scim.token_rotated', workspaceId, actorId, target: tokenTarget(id, old.label), metadata: { replaced: tokenId } });
  });
  return token;
}

export async function revokeToken(workspaceId: string, actorId: string, tokenId: string): Promise<void> {
  const old = (await repo.listTokens(workspaceId)).find((t) => t.id === tokenId);
  await repo.transaction(async () => {
    if (!(await repo.deleteToken(workspaceId, tokenId))) throw notFound('Token not found');
    await recordAudit({ action: 'scim.token_revoked', workspaceId, actorId, target: tokenTarget(tokenId, old?.label ?? '') });
  });
}

function cleanMapping(v: unknown): ScimGroupMapping | null {
  if (v === null || v === undefined) return null;
  const m = v as { kind?: unknown; role?: unknown; projectId?: unknown };
  if (m.kind === 'role' && (m.role === 'admin' || m.role === 'member' || m.role === 'guest')) return { kind: 'role', role: m.role };
  if (m.kind === 'project' && typeof m.projectId === 'string' && m.projectId) return { kind: 'project', projectId: m.projectId };
  throw badRequest('mapping must be null, { kind: "role", role: admin|member|guest } or { kind: "project", projectId }');
}

/** Changes what a group grants, and applies it to its members now. */
export async function mapGroup(workspaceId: string, actorId: string, groupId: string, body: { mapping?: unknown }): Promise<void> {
  const mapping = cleanMapping(body.mapping);
  const g = await repo.getGroup(workspaceId, groupId);
  if (!g) throw notFound('Group not found');
  if (mapping?.kind === 'project' && !(await projectOfWorkspace(mapping.projectId, workspaceId))) throw badRequest('That project is not in this workspace');
  const describe = (m: ScimGroupMapping | null) => (!m ? null : m.kind === 'role' ? `role:${m.role}` : `project:${m.projectId}`);
  await repo.transaction(async () => {
    if (!(await repo.setMapping(workspaceId, groupId, mapping, Date.now()))) throw notFound('Group not found');
    await recordAudit({
      action: 'scim.group_mapped',
      workspaceId,
      actorId,
      target: { type: 'scim_group', id: groupId, label: g.displayName },
      metadata: { from: describe(g.mapping), to: describe(mapping) },
    });
  });
  const unmapped = g.mapping?.kind === 'project' && (mapping?.kind !== 'project' || mapping.projectId !== g.mapping.projectId) ? [g.mapping.projectId] : [];
  // A role mapping changes everyone's roles (the directory starts or stops owning them).
  const affected = g.mapping?.kind === 'role' || mapping?.kind === 'role' ? (await repo.listUsers(workspaceId)).map((u) => u.userId) : await repo.groupMemberIds(groupId);
  for (const id of affected) await syncPerson(workspaceId, id, unmapped);
}
