// Who may use AI on a board, and through which provider. One rule, used by the status route, the
// action route and the app (which shows AI entry points only when it says yes):
//
//   instance off      no instance provider and no workspace keys allowed: AI doesn't exist (404)
//   personal boards   the operator's provider, if AI_INSTANCE_FOR includes `personal`
//   team boards       the workspace's admins turned AI on, with the operator's provider (if offered
//                     to teams) or their own; the person passes the workspace's "who may use AI"
//   always            edit access to the board (actions write it)
import { AI_PROVIDER_LABELS, type AiAccess, type AiProviderKind, type BoardAiStatus, type Role } from '@freero/shared';
import { getConfig, type AiConfig } from '../../platform/config';
import { notFound } from '../../platform/http';
import { unseal, seal } from '../../platform/secrets';
import { requireBoardAccess } from '../boards/index';
import { atLeast } from '../members/index';
import { getWorkspaceInfo, isFullMember, isManager, workspaceRole } from '../workspaces/index';
import type { ProviderEndpoint } from './providers';
import * as repo from './repo';

export const KEY_PURPOSE = 'ai-workspace-key-v1';

/** AI exists on this instance at all (else every AI route answers 404 and no AI UI shows). */
export const aiOffered = (c: AiConfig = getConfig().ai): boolean => c.instance !== null || c.workspaceKeys;

/** 404 unless AI exists on this instance. */
export function requireAiOffered(): void {
  if (!aiOffered()) throw notFound();
}

export interface AiGrant {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  kind: 'personal' | 'team';
  role: Role;
  source: 'instance' | 'workspace';
  endpoint: ProviderEndpoint;
  /** The workspace's monthly token budget (team setting), or null. */
  monthlyTokenBudget: number | null;
}

export type AiDecision = { ok: true; grant: AiGrant } | { ok: false; reason: string; role: Role };

const ACCESS_WORDS: Record<AiAccess, string> = {
  everyone: 'everyone',
  members: 'members of this workspace (not guests)',
  admins: 'this workspace’s owners and admins',
};

const label = (ep: { provider: keyof typeof AI_PROVIDER_LABELS; model: string }) =>
  `${ep.provider === 'anthropic' ? 'Anthropic (Claude)' : 'an OpenAI-compatible endpoint'} · ${ep.model}`;

/** The workspace's stored key, opened (and sealed again under the current secret when stale). */
async function openKey(workspaceId: string, sealed: string | null): Promise<string | null> {
  if (!sealed) return '';
  const opened = unseal(KEY_PURPOSE, sealed);
  if (!opened) return null;
  if (opened.stale) await repo.resealKey(workspaceId, sealed, seal(KEY_PURPOSE, opened.value));
  return opened.value;
}

/** Decides whether `userId` may run AI actions on the board now (404/403 for no access at all). */
export async function decideAi(boardId: string, userId: string): Promise<AiDecision> {
  requireAiOffered();
  const config = getConfig().ai;
  const board = await requireBoardAccess(boardId, userId, 'viewer');
  const no = (reason: string): AiDecision => ({ ok: false, reason, role: board.role });
  const ws = await getWorkspaceInfo(board.workspaceId);
  if (!ws) throw notFound('Board not found');
  if (!atLeast(board.role, 'editor')) return no('AI actions add to the board, so they need edit access.');
  const base = { boardId, boardTitle: board.title, workspaceId: ws.id, kind: ws.kind, role: board.role };

  if (ws.kind === 'personal') {
    if (!config.instance || !config.instanceFor.personal) return no('AI isn’t available for personal workspaces on this Freero server.');
    return { ok: true, grant: { ...base, source: 'instance', endpoint: { ...config.instance, untrusted: false }, monthlyTokenBudget: null } };
  }

  const s = await repo.getSettings(ws.id);
  if (!s?.enabled) return no('AI is off for this workspace. Its admins can turn it on in the admin console.');
  const wsRole = await workspaceRole(ws.id, userId);
  const allowed = s.access === 'everyone' || (s.access === 'members' ? isFullMember(wsRole) : isManager(wsRole));
  if (!allowed) return no(`In this workspace, AI is for ${ACCESS_WORDS[s.access]}.`);
  if (s.source === 'instance') {
    if (!config.instance || !config.instanceFor.teams) return no('This workspace’s AI provider isn’t available any more. Its admins need to check the AI settings.');
    return { ok: true, grant: { ...base, source: 'instance', endpoint: { ...config.instance, untrusted: false }, monthlyTokenBudget: s.monthlyTokenBudget } };
  }
  if (!config.workspaceKeys) return no('This Freero server doesn’t allow workspaces to bring their own AI provider any more.');
  const key = await openKey(ws.id, s.apiKeySealed);
  if (key === null) return no('This workspace’s AI key can’t be read any more. Its admins need to enter it again.');
  const endpoint = workspaceEndpoint(s, key);
  if (!endpoint.model) return no('This workspace’s AI provider isn’t fully set up. Its admins need to check the AI settings.');
  return { ok: true, grant: { ...base, source: 'workspace', endpoint, monthlyTokenBudget: s.monthlyTokenBudget } };
}

export const DEFAULT_BASE_URL: Record<AiProviderKind, string> = { anthropic: 'https://api.anthropic.com', openai: 'https://api.openai.com/v1' };
export const DEFAULT_MODEL: Record<AiProviderKind, string | null> = { anthropic: 'claude-sonnet-5-5', openai: null };

/** The endpoint a workspace's own settings describe (an untrusted URL: see providers.ts). */
export function workspaceEndpoint(s: repo.StoredAiSettings, apiKey: string): ProviderEndpoint {
  return { provider: s.provider, baseUrl: s.baseUrl ?? DEFAULT_BASE_URL[s.provider], model: s.model ?? DEFAULT_MODEL[s.provider] ?? '', apiKey, untrusted: true };
}

/** The workspace's key opened for a call ('' when none is stored; null when it can't be opened). */
export const workspaceKey = (s: repo.StoredAiSettings) => openKey(s.workspaceId, s.apiKeySealed);

/** What the app shows (never the key or the endpoint URL). */
export function statusOf(d: AiDecision): BoardAiStatus {
  return d.ok ? { available: true, provider: label(d.grant.endpoint), source: d.grant.source } : { available: false, reason: d.reason };
}

export { label as providerLabel };
