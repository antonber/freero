// The only writer of `slack_teams`, `slack_team_claims`, `slack_user_links` and `slack_oauth_flows` [S4] (#105, #193).
import { one, query, tx } from '../../platform/db';

// ---- workspaces the app was installed in ----

/** The sealed bot token stored for a Slack workspace, or null. */
export async function teamToken(teamId: string): Promise<string | null> {
  return (await one<{ bot_token: string }>(`SELECT bot_token FROM slack_teams WHERE team_id = $1`, [teamId]))?.bot_token ?? null;
}

/** A stale seal of the token re-sealed, unless the token changed or went meanwhile (never re-creates a row). */
export async function resealTeamToken(teamId: string, sealedBefore: string, sealedNow: string): Promise<void> {
  await query(`UPDATE slack_teams SET bot_token = $3 WHERE team_id = $1 AND bot_token = $2`, [teamId, sealedBefore, sealedNow]);
}

/** Forgets a Slack workspace: its token and everyone's link there (the app was uninstalled). */
export async function forgetTeam(teamId: string): Promise<number> {
  await query(`DELETE FROM slack_teams WHERE team_id = $1`, [teamId]);
  return (await query(`DELETE FROM slack_user_links WHERE team_id = $1 RETURNING 1`, [teamId])).length;
}

/**
 * Whether the workspace keeps its token, and the token itself, change only under this lock (taken
 * first in each transaction): a consent claiming the workspace, linking there, and the decision to
 * revoke serialise per Slack workspace.
 */
const lockTeam = (teamId: string) => query(`SELECT pg_advisory_xact_lock(hashtext('slack.teams'), hashtext($1))`, [teamId]);

/** How long a revoke in progress keeps a consent of the same token out (a crashed revoke stops counting). */
const REVOKING_FOR = "interval '2 minutes'";

/**
 * A consent Slack answered for `teamId` claims the workspace until it is linked (`linkAndStoreToken`)
 * or given up (`dropClaim`): while claimed, the token isn't revoked. Refused (false) while Freero is
 * revoking a token `sameToken` says is the one this consent got.
 */
export async function claimTeam(teamId: string, claimId: string, expiresAt: number, sameToken: (sealed: string) => boolean): Promise<boolean> {
  return tx(async () => {
    await lockTeam(teamId);
    const revoking = await one<{ bot_token: string }>(
      `SELECT bot_token FROM slack_teams WHERE team_id = $1 AND revoking_at > now() - ${REVOKING_FOR}`,
      [teamId],
    );
    if (revoking && sameToken(revoking.bot_token)) return false;
    await query(`DELETE FROM slack_team_claims WHERE expires_at < now()`);
    await query(`INSERT INTO slack_team_claims (claim_id, team_id, expires_at) VALUES ($1, $2, $3)`, [claimId, teamId, new Date(expiresAt)]);
    return true;
  });
}

export async function dropClaim(claimId: string): Promise<void> {
  await query(`DELETE FROM slack_team_claims WHERE claim_id = $1`, [claimId]);
}

/**
 * Finishes a claimed consent in one transaction: stores the workspace's token and links the Freero
 * account to the Slack account, replacing its previous link and taking the Slack account from any
 * other Freero account it was linked to (whoever just consented in Slack holds it). Returns the
 * Slack workspace the account was linked in before (null: none); 'expired' when the claim is gone
 * (nothing written: the token may have been revoked meanwhile).
 */
export async function linkAndStoreToken(l: SlackLink, sealedToken: string, claimId: string): Promise<{ previousTeam: string | null } | 'expired'> {
  return tx(async () => {
    await lockTeam(l.teamId);
    if (!(await one(`DELETE FROM slack_team_claims WHERE claim_id = $1 AND expires_at > now() RETURNING 1`, [claimId]))) return 'expired';
    await query(
      `INSERT INTO slack_teams (team_id, bot_token, updated_at, revoking_at) VALUES ($1, $2, $3, NULL)
       ON CONFLICT (team_id) DO UPDATE SET bot_token = excluded.bot_token, updated_at = excluded.updated_at, revoking_at = NULL`,
      [l.teamId, sealedToken, new Date(l.linkedAt)],
    );
    const before = await one<{ team_id: string }>(`SELECT team_id FROM slack_user_links WHERE user_id = $1`, [l.userId]);
    await query(`DELETE FROM slack_user_links WHERE team_id = $1 AND slack_user_id = $2 AND user_id <> $3`, [l.teamId, l.slackUserId, l.userId]);
    await query(
      `INSERT INTO slack_user_links (user_id, team_id, team_name, slack_user_id, slack_name, dm_channel, linked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET team_id = excluded.team_id, team_name = excluded.team_name, slack_user_id = excluded.slack_user_id,
         slack_name = excluded.slack_name, dm_channel = excluded.dm_channel, linked_at = excluded.linked_at`,
      [l.userId, l.teamId, l.teamName, l.slackUserId, l.slackName, l.dmChannel, new Date(l.linkedAt)],
    );
    return { previousTeam: before?.team_id ?? null };
  });
}

/**
 * When nobody is linked in the workspace and no consent claims it, marks its token as being revoked
 * and returns it (sealed) with the mark for `forgetRevokedToken`; null: it stays (or there is none,
 * or another revoke is under way).
 */
export async function startRevokingIfUnused(teamId: string): Promise<{ sealed: string; mark: Date } | null> {
  return tx(async () => {
    await lockTeam(teamId);
    if (await one(`SELECT 1 FROM slack_user_links WHERE team_id = $1 LIMIT 1`, [teamId])) return null;
    if (await one(`SELECT 1 FROM slack_team_claims WHERE team_id = $1 AND expires_at > now() LIMIT 1`, [teamId])) return null;
    const mark = new Date();
    const r = await one<{ bot_token: string }>(
      `UPDATE slack_teams SET revoking_at = $2 WHERE team_id = $1 AND (revoking_at IS NULL OR revoking_at <= now() - ${REVOKING_FOR}) RETURNING bot_token`,
      [teamId, mark],
    );
    return r ? { sealed: r.bot_token, mark } : null;
  });
}

/** The revoke `startRevokingIfUnused` marked is done: the token goes (unless a consent stored another meanwhile). */
export async function forgetRevokedToken(teamId: string, mark: Date): Promise<void> {
  await query(`DELETE FROM slack_teams WHERE team_id = $1 AND revoking_at = $2`, [teamId, mark]);
}

// ---- people's links ----

export interface SlackLink {
  userId: string;
  teamId: string;
  teamName: string;
  slackUserId: string;
  slackName: string;
  dmChannel: string;
  linkedAt: number;
}

interface LinkRow {
  user_id: string;
  team_id: string;
  team_name: string;
  slack_user_id: string;
  slack_name: string;
  dm_channel: string;
  linked_at: Date;
}

const toLink = (r: LinkRow): SlackLink => ({
  userId: r.user_id,
  teamId: r.team_id,
  teamName: r.team_name,
  slackUserId: r.slack_user_id,
  slackName: r.slack_name,
  dmChannel: r.dm_channel,
  linkedAt: r.linked_at.getTime(),
});

export async function linkOf(userId: string): Promise<SlackLink | null> {
  const r = await one<LinkRow>(`SELECT * FROM slack_user_links WHERE user_id = $1`, [userId]);
  return r ? toLink(r) : null;
}

/** The Freero account a Slack account is linked to, or null. */
export async function linkBySlackUser(teamId: string, slackUserId: string): Promise<SlackLink | null> {
  const r = await one<LinkRow>(`SELECT * FROM slack_user_links WHERE team_id = $1 AND slack_user_id = $2`, [teamId, slackUserId]);
  return r ? toLink(r) : null;
}

/** Removes the person's link; returns it (null: there was none). */
export async function deleteLink(userId: string): Promise<SlackLink | null> {
  const r = await one<LinkRow>(`DELETE FROM slack_user_links WHERE user_id = $1 RETURNING *`, [userId]);
  return r ? toLink(r) : null;
}

// ---- "Connect Slack" consents in progress ----

export async function insertFlow(stateHash: string, f: { userId: string; browserHash: string }, expiresAt: number): Promise<void> {
  await query(`DELETE FROM slack_oauth_flows WHERE expires_at < now()`);
  await query(`INSERT INTO slack_oauth_flows (state_hash, user_id, browser_hash, expires_at) VALUES ($1, $2, $3, $4)`, [
    stateHash,
    f.userId,
    f.browserHash,
    new Date(expiresAt),
  ]);
}

/** Takes a flow (single use: deleted in the same statement), unless expired. */
export async function takeFlow(stateHash: string): Promise<{ userId: string; browserHash: string } | null> {
  const r = await one<{ user_id: string; browser_hash: string }>(
    `DELETE FROM slack_oauth_flows WHERE state_hash = $1 AND expires_at > now() RETURNING user_id, browser_hash`,
    [stateHash],
  );
  return r ? { userId: r.user_id, browserHash: r.browser_hash } : null;
}
