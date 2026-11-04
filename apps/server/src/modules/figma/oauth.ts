// "Connect Figma" (#171): Figma's OAuth 2 consent for the operator's Figma app
// (developers.figma.com/docs/rest-api/oauth). It starts from Freero, signed in, and comes back to
// the callback, which only the same account in the same browser can finish: the state is single
// use, ten minutes, stored as a hash and bound to an HttpOnly cookie set at the start (Slack's and
// the trackers' pattern) — so a callback someone else started, with their Figma code, connects
// nothing to you. The code is redeemed with the app's secret; the tokens are sealed at once.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { getConfig } from '../../platform/config';
import { HttpError, notFound, parseCookies } from '../../platform/http';
import { logger } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { safeReturnPath } from '../auth/index';
import { FigmaApiError, figmaMe, redeemCode } from './api';
import * as repo from './repo';
import { sealToken } from './tokens';

const COOKIE = 'freero_figma_oauth';
const COOKIE_PATH = '/api/integrations/figma/oauth';
const FLOW_TTL_MS = 10 * 60_000;
/** Read-only: who you are, a file's content (frames, renders) and its name. */
export const FIGMA_SCOPES = ['current_user:read', 'file_content:read', 'file_metadata:read'];
export const FIGMA_CALLBACK_PATH = '/api/integrations/figma/oauth/callback';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const callbackUrl = (req: Request) => appUrl(req, FIGMA_CALLBACK_PATH);

function oauthApp() {
  const figma = getConfig().figma;
  if (!figma) throw notFound('This server doesn’t offer Place from Figma', 'figma_unavailable');
  return figma;
}

/** `return` + the outcome, as query parameters the board's picker reads. */
function back(res: Response, returnPath: string, params: Record<string, string>): void {
  const u = new URL(returnPath, 'http://x');
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  res.redirect(302, `${u.pathname}${u.search}${u.hash}`);
}

export async function startFigmaConnect(req: Request, res: Response, userId: string): Promise<void> {
  const app = oauthApp();
  const state = randomBytes(32).toString('base64url');
  const browser = randomBytes(32).toString('base64url');
  const returnPath = safeReturnPath(req.query.return, '/app');
  await repo.insertFlow(sha256(state), { userId, browserHash: sha256(browser), returnPath }, Date.now() + FLOW_TTL_MS);
  res.cookie(COOKIE, browser, { httpOnly: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: FLOW_TTL_MS, secure: getConfig().production && req.secure });
  const q = new URLSearchParams({ client_id: app.clientId, redirect_uri: callbackUrl(req), scope: FIGMA_SCOPES.join(','), state, response_type: 'code' });
  res.redirect(302, `${app.oauthUrl}?${q}`);
}

export async function finishFigmaConnect(req: Request, res: Response, userId: string): Promise<void> {
  oauthApp();
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  const flow = state ? await repo.takeFlow(sha256(state)) : null;
  const browser = parseCookies(req.headers.cookie)[COOKIE] ?? '';
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  if (!flow || flow.userId !== userId || !browser || !sameHash(sha256(browser), flow.browserHash)) {
    logger.warn({ figma: { refused: 'oauth_state' } }, 'figma connect refused');
    throw new HttpError(400, 'This Figma authorization didn’t start in this browser, or it expired. Start again from Freero.', 'figma_oauth_state');
  }
  const fail = (code: string) => back(res, flow.returnPath, { figma_error: code });
  if (!code) return fail(req.query.error === 'access_denied' ? 'cancelled' : 'failed');
  try {
    const now = Date.now();
    const tokens = await redeemCode(code, callbackUrl(req), now);
    const me = await figmaMe(tokens.accessToken);
    await repo.setAccount(
      {
        userId,
        figmaUserId: me.id,
        handle: me.handle,
        email: me.email,
        accessToken: sealToken(tokens.accessToken),
        refreshToken: tokens.refreshToken ? sealToken(tokens.refreshToken) : null,
        expiresAt: tokens.expiresAt,
      },
      now,
    );
    await recordAudit({ action: 'figma.account_linked', accountId: userId, fanOut: false, target: { type: 'figma_account', id: me.id, label: me.handle } });
  } catch (e) {
    if (!(e instanceof FigmaApiError)) throw e;
    logger.warn({ figma: { connect: 'refused', status: e.status } }, 'figma connect failed');
    return fail('failed');
  }
  back(res, flow.returnPath, { figma: 'connected' });
}
