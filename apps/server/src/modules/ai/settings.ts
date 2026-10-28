// A team workspace's AI settings (admin console "AI" tab): on/off, Freero's provider or the
// workspace's own (provider, endpoint, model, key), a monthly token budget, and who may use it;
// plus this month's usage. The key is sealed at rest (platform/secrets) and never sent back.
import {
  type AiAccess,
  type AiProviderKind,
  type WorkspaceAiAdmin,
  type WorkspaceAiSettings,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { seal } from '../../platform/secrets';
import { requireAdmin } from '../admin/index';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { KEY_PURPOSE, providerLabel, requireAiOffered, workspaceEndpoint, workspaceKey } from './access';
import { callModel, checkEndpoint, ProviderError } from './providers';
import * as repo from './repo';
import { monthOf } from './service';

const PROVIDERS: AiProviderKind[] = ['anthropic', 'openai'];
const ACCESS: AiAccess[] = ['everyone', 'members', 'admins'];
const MODEL_RE = /^[\w.:/@+-]{1,200}$/;

const instanceForTeams = () => {
  const c = getConfig().ai;
  return c.instance !== null && c.instanceFor.teams;
};

function defaults(workspaceId: string): repo.StoredAiSettings {
  return {
    workspaceId,
    enabled: false,
    source: instanceForTeams() ? 'instance' : 'workspace',
    provider: 'anthropic',
    baseUrl: null,
    model: null,
    apiKeySealed: null,
    monthlyTokenBudget: null,
    access: 'members',
  };
}

const publicSettings = (s: repo.StoredAiSettings): WorkspaceAiSettings => ({
  enabled: s.enabled,
  source: s.source,
  provider: s.provider,
  baseUrl: s.baseUrl,
  model: s.model,
  hasKey: !!s.apiKeySealed,
  monthlyTokenBudget: s.monthlyTokenBudget,
  access: s.access,
});

async function view(workspaceId: string, s: repo.StoredAiSettings): Promise<WorkspaceAiAdmin> {
  const c = getConfig().ai;
  const month = monthOf();
  const rows = await repo.workspaceUsage(workspaceId, month);
  const users = await getUsers(rows.map((r) => r.userId));
  return {
    settings: publicSettings(s),
    instance: { available: instanceForTeams(), provider: instanceForTeams() && c.instance ? providerLabel(c.instance) : null },
    workspaceKeysAllowed: c.workspaceKeys,
    usage: {
      month,
      requests: rows.reduce((n, r) => n + r.requests, 0),
      inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
      outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
      byUser: rows.map((r) => ({ ...r, name: users.get(r.userId)?.name ?? 'Deleted user' })),
    },
  };
}

/** 404 when AI doesn't exist here, 403 unless an owner/admin of the team workspace. */
async function requireAiAdmin(workspaceId: string, userId: string): Promise<{ name: string }> {
  requireAiOffered();
  return requireAdmin(workspaceId, userId);
}

export async function getAiAdmin(workspaceId: string, userId: string): Promise<WorkspaceAiAdmin> {
  await requireAiAdmin(workspaceId, userId);
  return view(workspaceId, (await repo.getSettings(workspaceId)) ?? defaults(workspaceId));
}

export async function updateAiSettings(workspaceId: string, userId: string, body: unknown): Promise<WorkspaceAiAdmin> {
  const { name } = await requireAiAdmin(workspaceId, userId);
  const c = getConfig().ai;
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b !== 'object' || Array.isArray(b)) throw badRequest('Send the AI settings to change as an object');
  const prev = (await repo.getSettings(workspaceId)) ?? defaults(workspaceId);
  const next: repo.StoredAiSettings = { ...prev };
  const changed: string[] = [];
  const set = <K extends keyof repo.StoredAiSettings>(k: K, v: repo.StoredAiSettings[K]) => {
    if (next[k] !== v) changed.push(k);
    next[k] = v;
  };

  if ('enabled' in b) {
    if (typeof b.enabled !== 'boolean') throw badRequest('enabled must be true or false');
    set('enabled', b.enabled);
  }
  if ('source' in b) {
    if (b.source !== 'instance' && b.source !== 'workspace') throw badRequest('source must be instance or workspace');
    set('source', b.source);
  }
  if ('provider' in b) {
    if (!PROVIDERS.includes(b.provider as AiProviderKind)) throw badRequest(`provider must be ${PROVIDERS.join(' or ')}`);
    set('provider', b.provider as AiProviderKind);
  }
  if ('baseUrl' in b) {
    if (b.baseUrl !== null && (typeof b.baseUrl !== 'string' || b.baseUrl.length > 500)) throw badRequest('baseUrl must be a URL or null');
    const v = typeof b.baseUrl === 'string' && b.baseUrl.trim() ? b.baseUrl.trim().replace(/\/+$/, '') : null;
    if (v) {
      try {
        checkEndpoint(v, { blockPrivate: !c.workspacePrivateEndpoints, httpsOnly: !c.workspacePrivateEndpoints });
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : 'Invalid endpoint');
      }
    }
    set('baseUrl', v);
  }
  if ('model' in b) {
    if (b.model !== null && (typeof b.model !== 'string' || (b.model.trim() && !MODEL_RE.test(b.model.trim()))))
      throw badRequest('model must be a model id (letters, digits and . : / @ + - _)');
    set('model', typeof b.model === 'string' && b.model.trim() ? b.model.trim() : null);
  }
  let keyChange: 'replaced' | 'removed' | null = null;
  if ('apiKey' in b) {
    if (b.apiKey !== null && (typeof b.apiKey !== 'string' || b.apiKey.length > 1000 || /\s/.test(b.apiKey.trim())))
      throw badRequest('apiKey must be the key (no spaces) or null');
    const key = typeof b.apiKey === 'string' ? b.apiKey.trim() : '';
    if (key) {
      next.apiKeySealed = seal(KEY_PURPOSE, key);
      keyChange = 'replaced';
    } else if (prev.apiKeySealed) {
      next.apiKeySealed = null;
      keyChange = 'removed';
    }
  }
  if ('monthlyTokenBudget' in b) {
    const v = b.monthlyTokenBudget;
    if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 1000 || v > 10_000_000_000))
      throw badRequest('monthlyTokenBudget must be a whole number of tokens from 1000, or null for no budget');
    set('monthlyTokenBudget', v as number | null);
  }
  if ('access' in b) {
    if (!ACCESS.includes(b.access as AiAccess)) throw badRequest(`access must be ${ACCESS.join(', ')}`);
    set('access', b.access as AiAccess);
  }

  // Only a setup that can work may be switched on.
  if (next.enabled) {
    if (next.source === 'instance' && !instanceForTeams()) throw badRequest('This Freero server doesn’t offer its own AI provider to team workspaces. Use your own provider.');
    if (next.source === 'workspace') {
      if (!c.workspaceKeys) throw badRequest('This Freero server doesn’t allow workspaces to bring their own AI provider.');
      if (next.provider === 'openai' && !next.model) throw badRequest('Enter the model id your endpoint serves');
      if (!next.apiKeySealed && !next.baseUrl) throw badRequest('Enter the API key for this provider');
    }
  }
  if (!changed.length && !keyChange) return view(workspaceId, prev);

  await repo.transaction(async () => {
    await repo.saveSettings(next, userId);
    await recordAudit({
      action: 'ai.settings_changed',
      workspaceId,
      actorId: userId,
      target: { type: 'workspace', id: workspaceId, label: name },
      metadata: {
        changed: [...changed, ...(keyChange ? ['apiKey'] : [])],
        enabled: next.enabled,
        source: next.source,
        provider: next.provider,
        model: next.model,
        // The endpoint's host only (a URL could carry a path someone considers private).
        endpoint: next.baseUrl ? new URL(next.baseUrl).host : null,
        monthlyTokenBudget: next.monthlyTokenBudget,
        access: next.access,
        ...(keyChange ? { apiKey: keyChange } : {}),
      },
    });
  });
  return view(workspaceId, next);
}

/** One tiny call with the saved settings, so an admin sees at once whether the key and model work. */
export async function testAiSettings(workspaceId: string, userId: string): Promise<{ ok: true; model: string }> {
  await requireAiAdmin(workspaceId, userId);
  const c = getConfig().ai;
  const s = (await repo.getSettings(workspaceId)) ?? defaults(workspaceId);
  let ep;
  if (s.source === 'instance') {
    if (!c.instance || !instanceForTeams()) throw badRequest('This Freero server doesn’t offer its own AI provider to team workspaces.');
    ep = { ...c.instance, untrusted: false };
  } else {
    if (!c.workspaceKeys) throw badRequest('This Freero server doesn’t allow workspaces to bring their own AI provider.');
    const key = await workspaceKey(s);
    if (key === null) throw badRequest('The stored key can’t be read any more. Enter it again.');
    ep = workspaceEndpoint(s, key);
    if (!ep.model) throw badRequest('Enter the model id your endpoint serves');
  }
  try {
    const reply = await callModel(
      ep,
      {
        system: 'Reply with exactly this JSON object and nothing else: {"ok": true}',
        messages: [{ role: 'user', content: 'Connection test from Freero.' }],
        maxTokens: 512,
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
        timeoutMs: Math.min(c.timeoutMs, 30_000),
      },
      { allowPrivate: c.workspacePrivateEndpoints },
    );
    await repo.addUsage({ workspaceId, userId, month: monthOf(), source: s.source, inputTokens: reply.inputTokens, outputTokens: reply.outputTokens });
    if (!reply.text.trim()) throw new ProviderError('The model answered with nothing.');
  } catch (e) {
    if (e instanceof ProviderError) throw new HttpError(502, e.message, 'ai_provider');
    throw e;
  }
  return { ok: true, model: ep.model };
}

// ---- data exports (modules/privacy) ----

/** A person's metered AI usage (counts only: no prompts or content are ever stored). */
export async function aiUsageExportOf(userId: string) {
  return (await repo.usageOfUser(userId)).map(({ userId: _u, ...r }) => r);
}

/** A workspace's AI settings (never the key) and usage. */
export async function aiWorkspaceExportOf(workspaceId: string) {
  const s = await repo.getSettings(workspaceId);
  return { settings: s ? publicSettings(s) : null, usage: await repo.usageOfWorkspace(workspaceId) };
}
