// People's Slack links and the app's bot token per Slack workspace (#105). A link is the person's
// Slack user id in one Slack workspace, proven by Slack's OAuth consent (oauth.ts); Freero holds no
// token of the person's. The bot token a consent returns is the app's in that workspace, sealed at
// rest; SLACK_BOT_TOKEN stands in for workspaces without one (the operator's own). It is kept
// exactly while someone in that Slack workspace is linked or a consent there is in flight
// (releaseSlackTeam, #193).
import type { ApiScope, SlackAccountInfo } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { logger } from '../../platform/log';
import { currentRequestContext, runWithRequestContext } from '../../platform/requestContext';
import { seal, unseal } from '../../platform/secrets';
import { trackProductEvent } from '../analytics/index';
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

/** Whether the app may carry something of this workspace to `userId`'s Slack (one check, see slackReach). */
export function slackMayReach(userId: string, workspaceId: string): Promise<boolean> {
  return integrationMayReach(workspaceId, SLACK_INTEGRATION, userId);
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
  if (sealed && opened?.stale) await repo.resealTeamToken(teamId, sealed, seal(TOKEN_PURPOSE, opened.value));
  return opened?.value ?? slack.botToken;
}

/** How long a consent Slack answered may take to finish (two more Slack calls) before its claim lapses. */
const CLAIM_TTL_MS = 10 * 60_000;

/**
 * A consent Slack answered with `token` for `teamId` claims the workspace: until it is linked or
 * given up, Disconnect there doesn't revoke the app's token. False: Freero is revoking that very
 * token right now (the consent can't use it; the person tries again).
 */
export function claimSlackTeam(teamId: string, claimId: string, token: string): Promise<boolean> {
  return repo.claimTeam(teamId, claimId, Date.now() + CLAIM_TTL_MS, (sealed) => unseal(TOKEN_PURPOSE, sealed)?.value === token);
}

/**
 * Finishes a claimed consent: stores the workspace's token and the person's link together. When
 * this moved their link from another Slack workspace, that one is released (releaseSlackTeam).
 * False: the claim lapsed, nothing was linked.
 */
export async function linkSlack(link: repo.SlackLink, token: string, claimId: string): Promise<boolean> {
  const r = await repo.linkAndStoreToken(link, seal(TOKEN_PURPOSE, token), claimId);
  if (r === 'expired') return false;
  if (r.previousTeam && r.previousTeam !== link.teamId) await releaseSlackTeam(r.previousTeam);
  trackProductEvent(link.userId, { name: 'integration_connected', integration: 'slack' });
  return true;
}

/** A claimed consent that won't be linked (Slack refused a later step): the claim goes, and the workspace is released. */
export async function abandonSlackClaim(teamId: string, claimId: string): Promise<void> {
  await repo.dropClaim(claimId);
  await releaseSlackTeam(teamId);
}

/**
 * When nobody in a Slack workspace is linked any more and no consent there is in flight, Freero
 * forgets the app's token there and revokes it with Slack (auth.revoke) — unless it is
 * SLACK_BOT_TOKEN, the operator's own, which only the operator manages. Decided under the
 * workspace's lock (repo.startRevokingIfUnused); every path that removes a link ends here.
 */
async function releaseSlackTeam(teamId: string): Promise<void> {
  const r = await repo.startRevokingIfUnused(teamId);
  if (!r) return;
  const token = unseal(TOKEN_PURPOSE, r.sealed)?.value ?? null;
  if (token && token !== getConfig().slack?.botToken) {
    const answer = await callSlack('auth.revoke', token, {}, { form: true });
    logger.info({ slack: { revoked: teamId, ok: answer.ok, error: answer.error ?? null } }, 'slack token revoked');
  }
  await repo.forgetRevokedToken(teamId, r.mark);
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

/** Disconnects the person's Slack account (Disconnect, or their account being deleted); see releaseSlackTeam. */
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
  await releaseSlackTeam(link.teamId);
  return true;
}

/** Slack says the app is gone from a workspace (app_uninstalled, tokens_revoked): forget it there. */
export async function forgetSlackTeam(teamId: string): Promise<void> {
  if (!teamId) return;
  const links = await repo.forgetTeam(teamId);
  logger.info({ slack: { forgotTeam: teamId, links } }, 'slack workspace forgotten');
}
