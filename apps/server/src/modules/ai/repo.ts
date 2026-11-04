// The only writer of `ai_workspace_settings`, `ai_usage`, `ai_assistant_messages` and `ai_workflows` [S4].
import type { AiAccess, AiProviderKind, AiWorkflowScope } from '@freero/shared';
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

// ---- the board assistant's conversations (#1) ----

export interface StoredAssistantMessage {
  id: string;
  boardId: string;
  userId: string;
  at: number;
  /** The data key `body` is sealed with (`<workspaceId>:<version>`), or null. */
  sealedWith: string | null;
  body: Buffer;
}

interface AssistantRow {
  id: string;
  board_id: string;
  user_id: string;
  created_at: Date;
  sealed_with: string | null;
  body: Buffer | Uint8Array;
}

const toMessage = (r: AssistantRow): StoredAssistantMessage => ({
  id: r.id,
  boardId: r.board_id,
  userId: r.user_id,
  at: r.created_at.getTime(),
  sealedWith: r.sealed_with,
  body: Buffer.from(r.body),
});

/** Appends messages (in order) and keeps only the newest `keep` of that conversation. One transaction. */
export async function appendAssistantMessages(rows: readonly StoredAssistantMessage[], keep: number): Promise<void> {
  if (!rows.length) return;
  await tx(async () => {
    for (const m of rows)
      await query('INSERT INTO ai_assistant_messages (id, board_id, user_id, created_at, sealed_with, body) VALUES ($1, $2, $3, $4, $5, $6)', [
        m.id,
        m.boardId,
        m.userId,
        new Date(m.at),
        m.sealedWith,
        m.body,
      ]);
    const { boardId, userId } = rows[0];
    await query(
      `DELETE FROM ai_assistant_messages WHERE board_id = $1 AND user_id = $2 AND n NOT IN (
         SELECT n FROM ai_assistant_messages WHERE board_id = $1 AND user_id = $2 ORDER BY n DESC LIMIT $3)`,
      [boardId, userId, keep],
    );
  });
}

/** One person's conversation on one board, oldest first (the newest `limit`). */
export async function assistantMessages(boardId: string, userId: string, limit: number): Promise<StoredAssistantMessage[]> {
  const rows = await query<AssistantRow>(
    `SELECT * FROM (SELECT * FROM ai_assistant_messages WHERE board_id = $1 AND user_id = $2 ORDER BY n DESC LIMIT $3) m ORDER BY n`,
    [boardId, userId, limit],
  );
  return rows.map(toMessage);
}

export async function deleteAssistantConversation(boardId: string, userId: string): Promise<void> {
  await query('DELETE FROM ai_assistant_messages WHERE board_id = $1 AND user_id = $2', [boardId, userId]);
}

/** Every message of a person, on every board (data export), oldest first. */
export async function assistantMessagesOfUser(userId: string): Promise<StoredAssistantMessage[]> {
  const rows = await query<AssistantRow>('SELECT * FROM ai_assistant_messages WHERE user_id = $1 ORDER BY board_id, n', [userId]);
  return rows.map(toMessage);
}

// ---- saved workflows (#1) ----

export interface StoredWorkflow {
  id: string;
  ownerId: string;
  workspaceId: string | null;
  name: string;
  prompt: string;
  scope: AiWorkflowScope;
  createdAt: number;
  updatedAt: number;
}
interface WorkflowRow {
  id: string;
  owner_id: string;
  workspace_id: string | null;
  name: string;
  prompt: string;
  scope: AiWorkflowScope;
  created_at: Date;
  updated_at: Date;
}
const toWorkflow = (r: WorkflowRow): StoredWorkflow => ({
  id: r.id,
  ownerId: r.owner_id,
  workspaceId: r.workspace_id,
  name: r.name,
  prompt: r.prompt,
  scope: r.scope,
  createdAt: r.created_at.getTime(),
  updatedAt: r.updated_at.getTime(),
});

/** A person's own workflows and those shared with `workspaceId` (when given), newest first. */
export async function workflowsFor(userId: string, workspaceId: string | null): Promise<StoredWorkflow[]> {
  const rows = await query<WorkflowRow>(
    'SELECT * FROM ai_workflows WHERE owner_id = $1 OR ($2::text IS NOT NULL AND workspace_id = $2) ORDER BY updated_at DESC, id',
    [userId, workspaceId],
  );
  return rows.map(toWorkflow);
}

export async function workflowsOwnedBy(userId: string): Promise<StoredWorkflow[]> {
  return (await query<WorkflowRow>('SELECT * FROM ai_workflows WHERE owner_id = $1 ORDER BY created_at, id', [userId])).map(toWorkflow);
}

export async function workflowsSharedWith(workspaceId: string): Promise<StoredWorkflow[]> {
  return (await query<WorkflowRow>('SELECT * FROM ai_workflows WHERE workspace_id = $1 ORDER BY created_at, id', [workspaceId])).map(toWorkflow);
}

export async function getWorkflow(id: string): Promise<StoredWorkflow | null> {
  const r = await one<WorkflowRow>('SELECT * FROM ai_workflows WHERE id = $1', [id]);
  return r ? toWorkflow(r) : null;
}

/** Serialises a person's workflow creation (the per-person cap holds under concurrent saves). */
export async function lockWorkflowOwner(userId: string): Promise<void> {
  await query(`SELECT pg_advisory_xact_lock(hashtext('ai.workflows'), hashtext($1))`, [userId]);
}

export async function countWorkflowsOf(userId: string): Promise<number> {
  const r = await one<{ n: string | number }>('SELECT count(*) AS n FROM ai_workflows WHERE owner_id = $1', [userId]);
  return Number(r?.n ?? 0);
}

export async function insertWorkflow(w: StoredWorkflow): Promise<void> {
  await query('INSERT INTO ai_workflows (id, owner_id, workspace_id, name, prompt, scope, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [
    w.id,
    w.ownerId,
    w.workspaceId,
    w.name,
    w.prompt,
    w.scope,
    new Date(w.createdAt),
    new Date(w.updatedAt),
  ]);
}

export async function updateWorkflow(w: StoredWorkflow): Promise<void> {
  await query('UPDATE ai_workflows SET name = $2, prompt = $3, scope = $4, workspace_id = $5, updated_at = $6 WHERE id = $1', [
    w.id,
    w.name,
    w.prompt,
    w.scope,
    w.workspaceId,
    new Date(w.updatedAt),
  ]);
}

export async function deleteWorkflow(id: string): Promise<void> {
  await query('DELETE FROM ai_workflows WHERE id = $1', [id]);
}

/** Someone left a workspace (or became a guest): what they shared with it is theirs alone again. */
export async function unshareWorkflowsOf(userId: string, workspaceId: string, now: number): Promise<void> {
  await query('UPDATE ai_workflows SET workspace_id = NULL, updated_at = $3 WHERE owner_id = $1 AND workspace_id = $2', [userId, workspaceId, new Date(now)]);
}
