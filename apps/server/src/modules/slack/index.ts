// Public API of modules/slack [S2]. modules/notifications sends people's notifications to their
// Slack through `sendSlackDm` (#105); the data export reads `slackExportOf`.
export { sendSlackDm, type SlackDm, type SlackDmOutcome } from './dm';
// Whether this server offers "Connect Slack", and whether the person connected an account.
export { slackConnectOffered, slackLinked } from './links';
// Team workspace policies (API access, the app blocked, IP allowlist): what may go to Slack at all.
export { slackMayReach } from './links';
import * as repo from './repo';

/** For a person's data export: their Slack link (ids and names), never a token. */
export async function slackExportOf(userId: string): Promise<{ slack: null | { team: string; teamName: string; slackUser: string; slackName: string; linkedAt: string } }> {
  const l = await repo.linkOf(userId);
  return { slack: l ? { team: l.teamId, teamName: l.teamName, slackUser: l.slackUserId, slackName: l.slackName, linkedAt: new Date(l.linkedAt).toISOString() } : null };
}
