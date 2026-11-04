// People's Slack links and the app's bot token per Slack workspace (#105). A link is the person's
// Slack user id in one Slack workspace, proven by Slack's OAuth consent (oauth.ts); Freero holds no
// token of the person's. The bot token a consent returns is the app's in that workspace, sealed at
// rest; SLACK_BOT_TOKEN stands in for workspaces without one (the operator's own).
import type { ApiScope, SlackAccountInfo } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { logger } from '../../platform/log';
import { currentRequestContext, runWithRequestContext } from '../../platform/requestContext';
import { seal, unseal } from '../../platform/secrets';
import { integrationCredentialId, integrationMayReach } from '../apiauth/index';
import { recordAudit } from '../audit/index';
import { callSlack } from './api';
import * as repo from './repo';

const TOKEN_PURPOSE = 'slack-bot-token-v1';

// ---- team workspace policies ----

/** How the app appears in a team workspace's admin console (API access: apps and tokens). */
const SLACK_INTEGRATION = { id: 'slack', label: 'Slack (Freero’s Slack app)', scopes: ['boards:read', 'boards:write'] as ApiScope[] };

/**
 * Whether what Slack asks for `userId` may involve a workspace's boards — like an app they
 * connected: not in a workspace that turned API access off (or its organisation did), blocked the
 * app, or has an IP allowlist it didn't exempt the app from (Slack's servers ask, not the person's
 * network). One answer per workspace for the caller's lifetime (a command, an event).
 */
export function slackReach(userId: string): (workspaceId: string) => Promise<boolean> {
  const seen = new Map<string, Promise<boolean>>();
  return (workspaceId) => {
    let p = seen.get(workspaceId);
    if (!p) seen.set(workspaceId, (p = integrationMayReach(workspaceId, SLACK_INTEGRATION, userId)));
    return p;
  };
}

/**
 * Runs `fn` as the app acting for `userId`: board access then applies the IP exemptions a
 * workspace gave the app (apiauth's credential id in the request context, #156).
 */
export function actingAsSlackFor<T>(userId: string, fn: () => Promise<T>): Promise<T> {
  const ctx = currentRequestContext();
  return runWithRequestContext(
    { reqId: ctx?.reqId ?? 'slack', ip: ctx?.ip ?? null, userAgent: ctx?.userAgent ?? null, userId, apiCredentialId: integrationCredentialId(SLACK_INTEGRATION.id, userId) },
    fn,
  );
}

/** Whether this server offers "Connect Slack": the operator gave the app's OAuth credentials. */
export const slackConnectOffered = (): boolean => !!getConfig().slack?.oauth;

/** The bot token to call Slack with for a Slack workspace (its stored one, else SLACK_BOT_TOKEN). */
export async function botTokenFor(teamId: string): Promise<string | null> {
  const slack = getConfig().slack;
  if (!slack) return null;
  const sealed = teamId ? await repo.teamToken(teamId) : null;
  const opened = sealed ? unseal(TOKEN_PURPOSE, sealed) : null;
  if (opened?.stale) await repo.setTeamToken(teamId, seal(TOKEN_PURPOSE, opened.value), Date.now());
  return opened?.value ?? slack.botToken;
}

export function storeBotToken(teamId: string, token: string): Promise<void> {
  return repo.setTeamToken(teamId, seal(TOKEN_PURPOSE, token), Date.now());
}

export async function slackAccountOf(userId: string): Promise<SlackAccountInfo> {
  const offered = slackConnectOffered();
  const link = offered ? await repo.linkOf(userId) : null;
  return { offered, link: link ? { teamName: link.teamName, slackName: link.slackName, linkedAt: link.linkedAt } : null };
}

export async function slackLinked(userId: string): Promise<boolean> {
  return slackConnectOffered() && (await repo.linkOf(userId)) !== null;
}

/** The Freero account a Slack user is linked to, or null. */
export async function linkedUserOf(teamId: string, slackUserId: string | undefined): Promise<string | null> {
  if (!slackConnectOffered() || !teamId || !slackUserId) return null;
  return (await repo.linkBySlackUser(teamId, slackUserId))?.userId ?? null;
}

/**
 * Disconnects the person's Slack account. When nobody is linked in that Slack workspace any more,
 * Freero forgets the app's token there and revokes it with Slack (auth.revoke) — unless it is
 * SLACK_BOT_TOKEN, the operator's own, which only the operator manages.
 */
export async function unlinkSlack(userId: string): Promise<boolean> {
  const link = await repo.deleteLink(userId);
  if (!link) return false;
  await recordAudit({
    action: 'slack.account_unlinked',
    accountId: userId,
    fanOut: false,
    target: { type: 'slack_account', id: `${link.teamId}:${link.slackUserId}`, label: link.slackName },
    metadata: { team: link.teamId },
  });
  if ((await repo.linksInTeam(link.teamId)) === 0) {
    const sealed = await repo.teamToken(link.teamId);
    const token = sealed ? unseal(TOKEN_PURPOSE, sealed)?.value : null;
    if (sealed) await repo.deleteTeamToken(link.teamId);
    if (token && token !== getConfig().slack?.botToken) {
      const r = await callSlack('auth.revoke', token, {}, { form: true });
      logger.info({ slack: { revoked: link.teamId, ok: r.ok, error: r.error ?? null } }, 'slack token revoked');
    }
  }
  return true;
}

/** Slack says the app is gone from a workspace (app_uninstalled, tokens_revoked): forget it there. */
export async function forgetSlackTeam(teamId: string): Promise<void> {
  if (!teamId) return;
  const links = await repo.forgetTeam(teamId);
  logger.info({ slack: { forgotTeam: teamId, links } }, 'slack workspace forgotten');
}
