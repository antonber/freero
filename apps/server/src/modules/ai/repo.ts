// The only writer of `ai_workspace_settings` and `ai_usage` [S4].
import type { AiAccess, AiProviderKind } from '@freero/shared';
import { one, query, tx } from '../../platform/db';

/** Runs fn in one transaction (a change and its audit record commit together). */
export const transaction = <T>(fn: () => Promise<T>): Promise<T> => tx(() => fn());

export interface StoredAiSettings {
  workspaceId: string;
  enabled: boolean;
  source: 'instance' | 'workspace';
  provider: AiProviderKind;
  baseUrl: string | null;
  model: string | null;
  apiKeySealed: string | null;
  monthlyTokenBudget: number | null;
  access: AiAccess;
}

interface SettingsRow {
  workspace_id: string;
  enabled: boolean;
  source: 'instance' | 'workspace';
  provider: AiProviderKind;
  base_url: string | null;
  model: string | null;
  api_key_sealed: string | null;
  monthly_token_budget: string | number | null;
  access: AiAccess;
}

const toSettings = (r: SettingsRow): StoredAiSettings => ({
  workspaceId: r.workspace_id,
  enabled: r.enabled,
  source: r.source,
  provider: r.provider,
  baseUrl: r.base_url,
  model: r.model,
  apiKeySealed: r.api_key_sealed,
  monthlyTokenBudget: r.monthly_token_budget === null ? null : Number(r.monthly_token_budget),
  access: r.access,
});

export async function getSettings(workspaceId: string): Promise<StoredAiSettings | null> {
  const r = await one<SettingsRow>(`SELECT * FROM ai_workspace_settings WHERE workspace_id = $1`, [workspaceId]);
  return r ? toSettings(r) : null;
}

/** Writes the whole settings row (insert or replace). */
export async function saveSettings(s: StoredAiSettings, by: string, at = Date.now()): Promise<void> {
  await query(
    `INSERT INTO ai_workspace_settings
       (workspace_id, enabled, source, provider, base_url, model, api_key_sealed, monthly_token_budget, access, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (workspace_id) DO UPDATE SET
       enabled = EXCLUDED.enabled, source = EXCLUDED.source, provider = EXCLUDED.provider, base_url = EXCLUDED.base_url,
       model = EXCLUDED.model, api_key_sealed = EXCLUDED.api_key_sealed, monthly_token_budget = EXCLUDED.monthly_token_budget,
       access = EXCLUDED.access, updated_at = EXCLUDED.updated_at, updated_by = EXCLUDED.updated_by`,
    [s.workspaceId, s.enabled, s.source, s.provider, s.baseUrl, s.model, s.apiKeySealed, s.monthlyTokenBudget, s.access, new Date(at), by],
  );
}

/** Replaces a key sealed under a previous SESSION_SECRET, unless the row changed meanwhile. */
export async function resealKey(workspaceId: string, sealed: string, resealed: string): Promise<void> {
  await query(`UPDATE ai_workspace_settings SET api_key_sealed = $3 WHERE workspace_id = $1 AND api_key_sealed = $2`, [workspaceId, sealed, resealed]);
}

// ---- usage ----

export interface UsageDelta {
  workspaceId: string;
  userId: string;
  month: string;
  source: 'instance' | 'workspace';
  inputTokens: number;
  outputTokens: number;
}

/** Counts one call (a single upsert: concurrent calls never lose each other's counts). */
export async function addUsage(d: UsageDelta): Promise<void> {
  await query(
    `INSERT INTO ai_usage (workspace_id, user_id, month, source, requests, input_tokens, output_tokens)
     VALUES ($1, $2, $3, $4, 1, $5, $6)
     ON CONFLICT (workspace_id, month, user_id, source) DO UPDATE SET
       requests = ai_usage.requests + 1,
       input_tokens = ai_usage.input_tokens + EXCLUDED.input_tokens,
       output_tokens = ai_usage.output_tokens + EXCLUDED.output_tokens`,
    [d.workspaceId, d.userId, d.month, d.source, Math.max(0, Math.round(d.inputTokens)), Math.max(0, Math.round(d.outputTokens))],
  );
}

interface UsageRow {
  user_id: string;
  requests: string | number;
  input_tokens: string | number;
  output_tokens: string | number;
}
export interface UsageTotals {
  userId: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
}
const toTotals = (r: UsageRow): UsageTotals => ({
  userId: r.user_id,
  requests: Number(r.requests),
  inputTokens: Number(r.input_tokens),
  outputTokens: Number(r.output_tokens),
});

/** A workspace's usage in a month, per person (all sources). */
export async function workspaceUsage(workspaceId: string, month: string): Promise<UsageTotals[]> {
  const rows = await query<UsageRow>(
    `SELECT user_id, SUM(requests) AS requests, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens
       FROM ai_usage WHERE workspace_id = $1 AND month = $2 GROUP BY user_id ORDER BY SUM(input_tokens + output_tokens) DESC`,
    [workspaceId, month],
  );
  return rows.map(toTotals);
}

/** Tokens a workspace used in a month (all people, all sources). */
export async function workspaceTokens(workspaceId: string, month: string): Promise<number> {
  const r = await one<{ n: string | number | null }>(`SELECT SUM(input_tokens + output_tokens) AS n FROM ai_usage WHERE workspace_id = $1 AND month = $2`, [
    workspaceId,
    month,
  ]);
  return Number(r?.n ?? 0);
}

/** Tokens a person used through Freero's own provider in a month, across every workspace. */
export async function instanceTokensOf(userId: string, month: string): Promise<number> {
  const r = await one<{ n: string | number | null }>(
    `SELECT SUM(input_tokens + output_tokens) AS n FROM ai_usage WHERE user_id = $1 AND month = $2 AND source = 'instance'`,
    [userId, month],
  );
  return Number(r?.n ?? 0);
}

export interface UsageRecord extends UsageTotals {
  workspaceId: string;
  month: string;
  source: 'instance' | 'workspace';
}

/** Every usage row of a person (data export). */
export async function usageOfUser(userId: string): Promise<UsageRecord[]> {
  const rows = await query<UsageRow & { workspace_id: string; month: string; source: 'instance' | 'workspace' }>(
    `SELECT * FROM ai_usage WHERE user_id = $1 ORDER BY month, workspace_id`,
    [userId],
  );
  return rows.map((r) => ({ ...toTotals(r), workspaceId: r.workspace_id, month: r.month, source: r.source }));
}

/** Every usage row of a workspace (workspace export). */
export async function usageOfWorkspace(workspaceId: string): Promise<UsageRecord[]> {
  const rows = await query<UsageRow & { workspace_id: string; month: string; source: 'instance' | 'workspace' }>(
    `SELECT * FROM ai_usage WHERE workspace_id = $1 ORDER BY month, user_id`,
    [workspaceId],
  );
  return rows.map((r) => ({ ...toTotals(r), workspaceId: r.workspace_id, month: r.month, source: r.source }));
}
