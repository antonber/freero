// "Connect Slack" (#105): Slack's OAuth v2 consent for the operator's app
// (docs.slack.dev/authentication/installing-with-oauth). It starts from Freero, signed in, and
// comes back to the callback, which only the same account in the same browser can finish: the
// state is single use, 10 minutes, stored as a hash and bound to an HttpOnly cookie set at the
// start — so a callback URL someone else started (with their Slack code) links nothing to you.
// The code is redeemed with the app's client secret; Slack's answer names the Slack workspace and
// the Slack user who consented, which is what the link stores. Its bot token is stored (sealed)
// together with the link; until then the consent claims that Slack workspace (links.ts).
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { getConfig } from '../../platform/config';
import { HttpError, notFound, parseCookies } from '../../platform/http';
import { logger } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { callSlack } from './api';
import { abandonSlackClaim, claimSlackTeam, linkSlack } from './links';
import { SLACK_BOT_SCOPES, SLACK_OAUTH_CALLBACK_PATH } from './manifest';
import * as repo from './repo';

const COOKIE = 'freero_slack_oauth';
const COOKIE_PATH = '/api/integrations/slack/oauth';
const FLOW_TTL_MS = 10 * 60_000;
/** What DMs need; without them the consent is refused (an app whose scopes weren't updated yet). */
const NEEDED = ['chat:write', 'im:write'];

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const callbackUrl = (req: Request) => appUrl(req, SLACK_OAUTH_CALLBACK_PATH);

function oauthApp() {
  const slack = getConfig().slack;
  if (!slack?.oauth) throw notFound('This server doesn’t offer Connect Slack');
  return { ...slack.oauth, authorizeUrl: slack.authorizeUrl };
}

export async function startSlackConnect(req: Request, res: Response, userId: string): Promise<void> {
  const app = oauthApp();
  const state = randomBytes(32).toString('base64url');
  const browser = randomBytes(32).toString('base64url');
  await repo.insertFlow(sha256(state), { userId, browserHash: sha256(browser) }, Date.now() + FLOW_TTL_MS);
  res.cookie(COOKIE, browser, { httpOnly: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: FLOW_TTL_MS, secure: getConfig().production && req.secure });
  const q = new URLSearchParams({ client_id: app.clientId, scope: SLACK_BOT_SCOPES.join(','), redirect_uri: callbackUrl(req), state });
  res.redirect(302, `${app.authorizeUrl}?${q}`);
}

const back = (res: Response, query: string) => res.redirect(302, `/settings?${query}#slack`);

export async function finishSlackConnect(req: Request, res: Response, userId: string): Promise<void> {
  const app = oauthApp();
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const flow = state ? await repo.takeFlow(sha256(state)) : null;
  const browser = parseCookies(req.headers.cookie)[COOKIE] ?? '';
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  if (!flow || flow.userId !== userId || !browser || !sameHash(sha256(browser), flow.browserHash)) {
    logger.warn({ slack: { refused: 'oauth_state' } }, 'slack connect refused');
    throw new HttpError(400, 'This Slack authorization didn’t start in this browser, or it expired. Start again from Freero.');
  }
  const fail = (message: string) => back(res, `slack_error=${encodeURIComponent(message)}`);
  if (!code) return fail(req.query.error === 'access_denied' ? 'Connecting Slack was cancelled.' : 'Slack didn’t connect. Try again.');
  const r = await callSlack('oauth.v2.access', null, { client_id: app.clientId, client_secret: app.clientSecret, code, redirect_uri: callbackUrl(req) }, { form: true });
  const team = r.team as { id?: unknown; name?: unknown } | undefined;
  const authed = r.authed_user as { id?: unknown } | undefined;
  const token = typeof r.access_token === 'string' ? r.access_token : '';
  const granted = typeof r.scope === 'string' ? r.scope.split(',') : [];
  if (!r.ok || !token.startsWith('xoxb-') || typeof team?.id !== 'string' || typeof authed?.id !== 'string') {
    logger.warn({ slack: { connect: 'refused', error: r.error ?? 'bad_response' } }, 'slack connect failed');
    return fail('Slack didn’t accept the connection. Try again.');
  }
  if (!NEEDED.every((s) => granted.includes(s)))
    return fail('Freero’s Slack app can’t send direct messages yet. Ask your Freero operator to add its new scopes (see docs/integrations/slack.md).');
  const teamId = team.id;
  const slackUserId = authed.id;
  // Claimed before the token is relied on, so the last person there disconnecting meanwhile doesn't
  // revoke it; stored only together with the link (a consent that stops halfway keeps no token).
  const claim = randomBytes(16).toString('base64url');
  if (!(await claimSlackTeam(teamId, claim, token))) return fail('Slack didn’t connect. Try again.');
  let linked = false;
  let slackName = slackUserId;
  try {
    // The app's direct message with the person; their name there, to show in settings.
    const im = await callSlack('conversations.open', token, { users: slackUserId }, { form: true });
    const channel = (im.channel as { id?: unknown } | undefined)?.id;
    if (!im.ok || typeof channel !== 'string') {
      logger.warn({ slack: { connect: 'no_dm', error: im.error ?? null } }, 'slack connect failed');
      return fail('Slack didn’t let Freero open a direct message with you. Try again.');
    }
    const who = await callSlack('users.info', token, { user: slackUserId }, { form: true });
    const u = who.user as { name?: unknown; real_name?: unknown; profile?: { display_name?: unknown } } | undefined;
    slackName = ([u?.profile?.display_name, u?.real_name, u?.name].find((n): n is string => typeof n === 'string' && n.trim() !== '') ?? slackUserId).slice(0, 200);
    const teamName = typeof team.name === 'string' && team.name.trim() ? team.name.trim() : teamId;
    const link = { userId, teamId, teamName: teamName.slice(0, 200), slackUserId, slackName, dmChannel: channel, linkedAt: Date.now() };
    if (!(linked = await linkSlack(link, token, claim))) return fail('Slack didn’t connect. Try again.');
  } finally {
    if (!linked) await abandonSlackClaim(teamId, claim);
  }
  await recordAudit({
    action: 'slack.account_linked',
    accountId: userId,
    fanOut: false,
    target: { type: 'slack_account', id: `${teamId}:${slackUserId}`, label: slackName },
    metadata: { team: teamId },
  });
  back(res, 'slack=connected');
}
