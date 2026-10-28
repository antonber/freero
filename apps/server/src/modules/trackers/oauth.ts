// Connecting a tracker with OAuth 2.0 (Jira Cloud 3LO) through an app the operator registered
// (TRACKER_JIRA_CLIENT_ID / _SECRET). The consent starts from Freero (signed in; for a team, its
// owner/admin) and comes back to the callback, which only the browser that started it can finish:
// the state is single use, 10 minutes, stored as a hash, and bound to an HttpOnly cookie set at
// the start (like single sign-on). The tokens are sealed at once; nothing about them reaches the page.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { TrackerProviderKind } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError, notFound, parseCookies } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { requireAdmin } from '../admin/index';
import { createOAuthConnection, sha256 } from './connections';
import { TrackerError } from './http';
import { oauthProviderOf } from './providers/index';
import * as repo from './repo';

const COOKIE = 'freero_tracker_oauth';
const COOKIE_PATH = '/api/trackers/oauth';
const FLOW_TTL_MS = 10 * 60_000;

function appFor(provider: TrackerProviderKind) {
  const app = provider === 'jira' ? getConfig().trackers.jiraOAuth : null;
  const oauth = oauthProviderOf(provider);
  if (!app || !oauth) throw notFound('This server has no OAuth app for that tracker');
  return { app, oauth };
}

export const oauthOffered = (provider: TrackerProviderKind) => provider === 'jira' && !!getConfig().trackers.jiraOAuth;

const callbackUrl = (req: Request, provider: TrackerProviderKind) => appUrl(req, `/api/trackers/oauth/${provider}/callback`);

/** Where the person goes back to: the admin console's tab, or their settings. */
const backTo = (workspaceId: string | null) => (workspaceId ? `/admin/${encodeURIComponent(workspaceId)}?tab=trackers` : '/settings?section=trackers');

export async function startOAuth(req: Request, res: Response, userId: string, provider: TrackerProviderKind): Promise<void> {
  const { app, oauth } = appFor(provider);
  const workspaceId = typeof req.query.workspace === 'string' && req.query.workspace ? req.query.workspace : null;
  if (workspaceId) await requireAdmin(workspaceId, userId);
  const name = typeof req.query.name === 'string' && req.query.name.trim() ? req.query.name.trim().slice(0, 80) : 'Jira';
  const state = randomBytes(32).toString('base64url');
  const browser = randomBytes(32).toString('base64url');
  await repo.insertFlow(sha256(state), { provider, userId, workspaceId, browserHash: sha256(browser), name }, Date.now() + FLOW_TTL_MS);
  res.cookie(COOKIE, browser, {
    httpOnly: true,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: FLOW_TTL_MS,
    secure: getConfig().production && req.secure,
  });
  res.redirect(
    302,
    oauth.authorizeUrl({
      clientId: app.clientId,
      redirectUri: callbackUrl(req, provider),
      state,
    }),
  );
}

const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export async function finishOAuth(req: Request, res: Response, userId: string, provider: TrackerProviderKind): Promise<void> {
  const { app, oauth } = appFor(provider);
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const flow = state ? await repo.takeFlow(sha256(state)) : null;
  const browser = parseCookies(req.headers.cookie)[COOKIE] ?? '';
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  if (!flow || flow.provider !== provider || flow.userId !== userId || !browser || !sameHash(sha256(browser), flow.browserHash))
    throw new HttpError(400, 'This authorization didn’t start in this browser, or it expired. Start again from Freero.');
  const fail = (message: string) => res.redirect(302, `${backTo(flow.workspaceId)}&tracker_error=${encodeURIComponent(message)}`);
  if (!code) return fail(typeof req.query.error_description === 'string' ? req.query.error_description.slice(0, 200) : 'The authorization was cancelled.');
  if (flow.workspaceId) await requireAdmin(flow.workspaceId, userId);
  try {
    const { credentials, sites } = await oauth.redeem({
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      redirectUri: callbackUrl(req, provider),
      code,
    });
    if (!sites.length) return fail('That Atlassian account reaches no Jira site.');
    // One connection per site the consent reaches (usually one).
    for (const s of sites)
      await createOAuthConnection(userId, {
        workspaceId: flow.workspaceId,
        provider,
        name: sites.length > 1 ? `${flow.name} · ${s.name}` : flow.name,
        site: s.site,
        apiBase: s.apiBase,
        credentials,
      });
    res.redirect(302, `${backTo(flow.workspaceId)}&tracker_connected=1`);
  } catch (e) {
    if (e instanceof TrackerError) return fail(e.message);
    throw e;
  }
}
