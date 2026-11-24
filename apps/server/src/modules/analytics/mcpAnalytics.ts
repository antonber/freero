// MCP analytics for Freero's MCP server (modules/mcp), with PostHog's @posthog/mcp: which tools
// connected assistants call, how long they take, whether they fail, and which client and protocol
// called — under the same rules as the product events (productEvents.ts): only with POSTHOG_KEY,
// through the same client (batched, flushed at shutdown), under the account's pseudonym, nothing
// from a request that asked not to be tracked or for an account that turned analytics off, nothing
// for test addresses, the operators' calls marked `internal`.
//
// NEVER what a call carried. The SDK captures tool arguments ($mcp_parameters), results
// ($mcp_response), the agent's stated intent, error messages and stack traces by default — on
// Freero that is board and doc content — so every event is cut down to KEPT before it leaves
// (beforeSend: an allowlist, so a property a later SDK version adds stays out too), and the SDK
// adds no arguments to Freero's tools (`context`, `conversation_id`, `llm_model` off). How a call
// failed leaves only as one of MCP_FAILURES and its HTTP-like status, which the MCP server puts in
// the failed result's `_meta` (the SDK itself knows every answered refusal just as "Error").
import { instrument } from '@posthog/mcp';
import { getConfig } from '../../platform/config';
import { currentRequestContext } from '../../platform/requestContext';
import { analyticsAudienceOf } from '../auth/index';
import { productAnalyticsClient, pseudonym } from './productEvents';
import * as repo from './repo';

/** How a tool call can fail, as counted: whose move it is, never what was asked. */
export const MCP_FAILURES = ['missing_scope', 'permission', 'not_found', 'confirm_required', 'validation', 'conflict', 'rate_limited', 'internal'] as const;
export type McpFailure = (typeof MCP_FAILURES)[number];
/** Where a failed result says which (`_meta`): { kind, status }. */
export const MCP_FAILURE_META = 'app.freero/failure';

/** $mcp_error_type / $mcp_error_status of a failed call: the server's own word for it, else (arguments the SDK refused before any tool ran) validation. */
function failureOf(properties: Record<string, unknown>): Record<string, unknown> {
  const meta = (properties.$mcp_response as { _meta?: Record<string, unknown> } | undefined)?._meta?.[MCP_FAILURE_META] as { kind?: unknown; status?: unknown } | undefined;
  const kind = MCP_FAILURES.find((k) => k === meta?.kind);
  if (kind) return { $mcp_error_type: kind, ...(Number.isInteger(meta?.status) ? { $mcp_error_status: meta?.status } : {}) };
  return String(properties.$mcp_error_message ?? '').startsWith('Input validation error') ? { $mcp_error_type: 'validation' satisfies McpFailure } : {};
}

/** The events that may leave: calls, listings and the handshake. */
const EVENTS = new Set(['$mcp_tool_call', '$mcp_initialize', '$mcp_tools_list', '$mcp_resources_list', '$mcp_resource_read', '$mcp_prompts_list', '$mcp_prompt_get']);

/** The properties that may leave: names, timings, outcomes and versions — never values, text, addresses or which board. */
const KEPT = new Set([
  '$mcp_tool_name',
  '$mcp_tool_category',
  '$mcp_input_keys',
  '$mcp_input_aliases_used',
  '$mcp_duration_ms',
  '$mcp_is_error',
  '$mcp_error_type',
  '$mcp_error_status',
  '$mcp_listed_tool_names',
  '$mcp_client_name',
  '$mcp_client_version',
  '$mcp_vendor_client',
  '$mcp_protocol_version',
  '$mcp_server_name',
  '$mcp_server_version',
  '$mcp_server_build',
  '$mcp_interface',
  '$mcp_source',
  '$session_id',
  '$lib',
  '$lib_version',
]);

/**
 * For one MCP request acting for `accountId`: instruments the request's server, or null when
 * nothing may be counted (no POSTHOG_KEY, the request's privacy signal, the account's opt-out, a
 * test address). Call it before the server's tools are registered.
 */
export async function mcpAnalyticsFor(accountId: string): Promise<((server: unknown) => void) | null> {
  const client = productAnalyticsClient();
  if (!client || currentRequestContext()?.privacySignal) return null;
  const [optedOut, audience] = await Promise.all([repo.anyOptedOut([accountId]), analyticsAudienceOf(accountId)]);
  if (optedOut || audience === 'test') return null;
  const distinctId = pseudonym('account', accountId);
  const serverBuild = getConfig().release ?? undefined;
  return (server) => {
    instrument(server, client, {
      context: false,
      enableConversationId: false,
      captureModel: false,
      enableExceptionAutocapture: false,
      identify: { distinctId },
      ...(serverBuild ? { serverBuild } : {}),
      beforeSend: (event) => {
        if (!EVENTS.has(event.event)) return null;
        const properties: Record<string, unknown> = { $geoip_disable: true };
        for (const [k, v] of Object.entries(event.properties)) if (KEPT.has(k)) properties[k] = v;
        if (event.properties.$mcp_is_error) Object.assign(properties, failureOf(event.properties));
        if (audience === 'internal') properties.internal = true;
        return { ...event, distinct_id: distinctId, properties };
      },
    });
  };
}
