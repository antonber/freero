// The only writer of `slack_teams`, `slack_user_links` and `slack_oauth_flows` [S4] (#105).
import { one, query, tx } from '../../platform/db';

// ---- workspaces the app was installed in ----

/** The sealed bot token stored for a Slack workspace, or null. */
export async function teamToken(teamId: string): Promise<string | null> {
  return (await one<{ bot_token: string }>(`SELECT bot_token FROM slack_teams WHERE team_id = $1`, [teamId]))?.bot_token ?? null;
}

export async function setTeamToken(teamId: string, sealedToken: string, now: number): Promise<void> {
  await query(
    `INSERT INTO slack_teams (team_id, bot_token, updated_at) VALUES ($1, $2, $3)
     ON CONFLICT (team_id) DO UPDATE SET bot_token = excluded.bot_token, updated_at = excluded.updated_at`,
    [teamId, sealedToken, new Date(now)],
  );
}

/** Forgets a Slack workspace: its token and everyone's link there (the app was uninstalled). */
export async function forgetTeam(teamId: string): Promise<number> {
  await query(`DELETE FROM slack_teams WHERE team_id = $1`, [teamId]);
  return (await query(`DELETE FROM slack_user_links WHERE team_id = $1 RETURNING 1`, [teamId])).length;
}

export async function deleteTeamToken(teamId: string): Promise<void> {
  await query(`DELETE FROM slack_teams WHERE team_id = $1`, [teamId]);
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

/**
 * Links the Freero account to the Slack account, replacing its previous link and taking the Slack
 * account from any other Freero account it was linked to (whoever just consented in Slack holds it).
 */
export async function setLink(l: SlackLink): Promise<void> {
  await tx(async () => {
    await query(`DELETE FROM slack_user_links WHERE team_id = $1 AND slack_user_id = $2 AND user_id <> $3`, [l.teamId, l.slackUserId, l.userId]);
    await query(
      `INSERT INTO slack_user_links (user_id, team_id, team_name, slack_user_id, slack_name, dm_channel, linked_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE SET team_id = excluded.team_id, team_name = excluded.team_name, slack_user_id = excluded.slack_user_id,
         slack_name = excluded.slack_name, dm_channel = excluded.dm_channel, linked_at = excluded.linked_at`,
      [l.userId, l.teamId, l.teamName, l.slackUserId, l.slackName, l.dmChannel, new Date(l.linkedAt)],
    );
  });
}

/** Removes the person's link; returns it (null: there was none). */
export async function deleteLink(userId: string): Promise<SlackLink | null> {
  const r = await one<LinkRow>(`DELETE FROM slack_user_links WHERE user_id = $1 RETURNING *`, [userId]);
  return r ? toLink(r) : null;
}

export async function linksInTeam(teamId: string): Promise<number> {
  const r = await one<{ n: number | string }>(`SELECT count(*) AS n FROM slack_user_links WHERE team_id = $1`, [teamId]);
  return Number(r?.n ?? 0);
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
