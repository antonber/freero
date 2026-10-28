// Finishing a sign-in: straight to a session, or — when the account has two-factor on — a pending
// sign-in (HttpOnly cookie + auth_challenges row) that the second step completes. Every way in
// (password, password reset link, provider) goes through completeSignIn, so none skips the second
// step. Also the provider (OIDC) browser flow: start -> provider -> callback.
import { timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import type { Account, LoginResponse, OidcErrorCode } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError, parseCookies, unauthorized } from '../../platform/http';
import { log, logError } from '../../platform/log';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { recordAuditQuietly } from '../audit/index';
import { sendVerification } from './emails';
import { authorizationUrl, newAuthorizationChecks, OidcUnavailableError, redeemAuthorizationCode } from './oidc';
import { sendSecurityNotice } from './notices';
import { connectIdentity, isConnectedIdentity, linkProvider, providerConfig, providerLabel, resolveProviderLogin } from './providers';
import * as repo from './repo';
import { getAccount, hashToken, isSuspended, newToken, refuseIfSuspended, sessionFromCookieHeader, startSession } from './service';
import { useSecondFactor } from './twoFactor';

const CHALLENGE_COOKIE = 'freero_2fa';
const CHALLENGE_PATH = '/api/auth/login';
const CHALLENGE_TTL_MS = 10 * 60_000;
/** Wrong codes per pending sign-in; then it has to start over (on top of the rate limits). */
const CHALLENGE_MAX_ATTEMPTS = 5;

const FLOW_COOKIE = 'freero_oidc';
const FLOW_PATH = '/api/auth/oidc';
const FLOW_TTL_MS = 10 * 60_000;

function cookieOptions(req: Request, path: string, maxAge: number) {
  return { httpOnly: true, sameSite: 'lax' as const, path, maxAge, secure: getConfig().production && req.secure };
}

/**
 * The first factor is proven (`method`: 'password', 'email_link' or a provider id). Signs in, or
 * answers { twoFactorRequired } and remembers the pending sign-in (and an identity to connect after it).
 * `newAccount`: this sign-in created the account (no new-browser notice for its first browser).
 */
export async function completeSignIn(
  req: Request,
  res: Response,
  userId: string,
  method: string,
  { link = null, newAccount = false }: { link?: repo.PendingLink | null; newAccount?: boolean } = {},
): Promise<LoginResponse> {
  await refuseIfSuspended(userId); // before asking for a second step it could never finish
  if (await repo.twoFactorEnabled(userId)) {
    const token = newToken();
    const now = Date.now();
    await repo.insertChallenge(hashToken(token), { userId, method, link }, now, now + CHALLENGE_TTL_MS);
    res.cookie(CHALLENGE_COOKIE, token, cookieOptions(req, CHALLENGE_PATH, CHALLENGE_TTL_MS));
    return { twoFactorRequired: true };
  }
  if (link) await connectIdentity(req, userId, link);
  await openSession(req, res, userId, { method, newAccount });
  return { user: await getAccount(userId) };
}

/**
 * Starts the session of a completed sign-in and mails the owner when it came from a browser that
 * had not signed in to the account before. Not for a reset link (its "password reset" notice
 * already says so) or a just-created account.
 */
async function openSession(req: Request, res: Response, userId: string, how: { method: string; twoFactor?: boolean; newAccount?: boolean }): Promise<void> {
  const { knownDevice } = await startSession(req, res, userId, how);
  await recordAuditQuietly({
    action: 'auth.login',
    accountId: userId,
    actorId: userId,
    metadata: { method: how.method, twoFactor: how.twoFactor ?? false, newDevice: !knownDevice },
  });
  if (knownDevice || how.newAccount || how.method === 'email_link') return;
  const user = await getAccount(userId);
  sendSecurityNotice(req, user.email, { kind: 'new_sign_in', method: how.method === 'password' ? 'password' : providerLabel(how.method) });
}

const signInExpired = () => unauthorized('Your sign-in expired. Please log in again.');

/**
 * The pending sign-in of this browser (first factor proven, second not yet), without counting an
 * attempt — for starting a "lost my authenticator" recovery from it. 401 when there is none.
 */
export async function pendingSignIn(req: Request): Promise<repo.Challenge> {
  const token = parseCookies(req.headers.cookie)[CHALLENGE_COOKIE];
  const challenge = token ? await repo.findChallenge(hashToken(token), Date.now()) : null;
  if (!challenge) throw signInExpired();
  return challenge;
}

/** The second step: a code from the authenticator app or a recovery code. */
export async function finishTwoFactorSignIn(req: Request, res: Response, code: unknown): Promise<Account> {
  const token = parseCookies(req.headers.cookie)[CHALLENGE_COOKIE];
  if (!token) throw signInExpired();
  const key = hashToken(token);
  const challenge = await repo.attemptChallenge(key, Date.now(), CHALLENGE_MAX_ATTEMPTS);
  if (!challenge) {
    res.clearCookie(CHALLENGE_COOKIE, { path: CHALLENGE_PATH });
    throw signInExpired();
  }
  // Per account too, so a fresh pending sign-in (a known password) doesn't buy fresh guesses.
  await consumeRateLimit('twoFactor', `user:${challenge.userId}`);
  if (!(await useSecondFactor(challenge.userId, code, req))) {
    await recordAuditQuietly({ action: 'auth.login_failed', accountId: challenge.userId, actorId: null, target: { type: 'user', id: challenge.userId }, metadata: { reason: 'second_factor' } });
    throw new HttpError(403, 'That code is not right. Check your authenticator app and try again.');
  }
  // Single use: of two requests racing with right codes, one signs in.
  if (!(await repo.deleteChallenge(key))) throw signInExpired();
  res.clearCookie(CHALLENGE_COOKIE, { path: CHALLENGE_PATH });
  if (challenge.link) await connectIdentity(req, challenge.userId, challenge.link);
  await openSession(req, res, challenge.userId, { method: challenge.method, twoFactor: true });
  return getAccount(challenge.userId);
}

// ---- provider sign-in (OpenID Connect) ----

/** A same-site path to return to ("/board/x?y"), never another origin ("//evil", "/\evil"). */
export function safeReturnPath(next: unknown, fallback: string): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || next.length > 2000) return fallback;
  return next;
}

const redirectUri = (req: Request, provider: string) => appUrl(req, `/api/auth/oidc/${encodeURIComponent(provider)}/callback`);

/** GET /auth/oidc/:provider/start — remembers the request's secrets and sends the browser to the provider. */
export async function startProviderSignIn(req: Request, res: Response): Promise<void> {
  const provider = req.params.provider;
  const cfg = providerConfig(provider);
  const intent: repo.OidcIntent = req.query.intent === 'link' || req.query.intent === 'reauth' ? req.query.intent : 'login';
  const fallback = intent === 'login' ? '/app' : '/settings';
  const returnTo = safeReturnPath(req.query.next, fallback);
  const fail = (code: OidcErrorCode) => res.redirect(errorTarget(intent, code, returnTo));
  if (!cfg) return fail('unavailable');
  let userId: string | null = null;
  if (intent !== 'login') {
    const session = await sessionFromCookieHeader(req.headers.cookie);
    if (!session) return void res.redirect(`/login?next=${encodeURIComponent(returnTo)}`);
    userId = session.user.id;
  }
  const checks = newAuthorizationChecks();
  let url: string;
  try {
    url = await authorizationUrl(cfg, redirectUri(req, provider), checks);
  } catch (e) {
    if (!(e instanceof OidcUnavailableError)) throw e;
    log(`auth: ${cfg.label} sign-in unavailable: ${e.message}`);
    return fail('unavailable');
  }
  const now = Date.now();
  await repo.insertOidcFlow(
    hashToken(checks.state),
    { provider, intent, userId, codeVerifier: checks.codeVerifier, nonce: checks.nonce, returnTo },
    now,
    now + FLOW_TTL_MS,
  );
  // The state is also bound to this browser: a callback carrying someone else's state (login CSRF) fails.
  res.cookie(FLOW_COOKIE, checks.state, cookieOptions(req, FLOW_PATH, FLOW_TTL_MS));
  res.redirect(url);
}

function errorTarget(intent: repo.OidcIntent, code: OidcErrorCode, returnTo: string): string {
  if (intent === 'login') return `/login?error=${code}${returnTo !== '/app' ? `&next=${encodeURIComponent(returnTo)}` : ''}`;
  return `/settings?error=${code}`;
}

const sameState = (a: string, b: string) => {
  const x = Buffer.from(hashToken(a));
  const y = Buffer.from(hashToken(b));
  return timingSafeEqual(x, y);
};

/** GET /auth/oidc/:provider/callback — the provider sends the browser back here. */
export async function providerCallback(req: Request, res: Response): Promise<void> {
  const provider = req.params.provider;
  const cookieState = parseCookies(req.headers.cookie)[FLOW_COOKIE] ?? '';
  res.clearCookie(FLOW_COOKIE, { path: FLOW_PATH });
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const flow = state && cookieState && sameState(state, cookieState) ? await repo.takeOidcFlow(hashToken(state), Date.now()) : null;
  if (!flow || flow.provider !== provider) return void res.redirect(errorTarget('login', 'failed', '/app'));
  const fail = (code: OidcErrorCode) => res.redirect(errorTarget(flow.intent, code, flow.returnTo));
  if (typeof req.query.error === 'string') return fail(req.query.error === 'access_denied' ? 'cancelled' : 'failed');
  const cfg = providerConfig(provider);
  if (!cfg) return fail('unavailable');

  // The URL the provider redirected to, rebuilt on the registered redirect URI (not on whatever
  // host/protocol this request arrived with behind a proxy).
  const callbackUrl = new URL(redirectUri(req, provider));
  for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') callbackUrl.searchParams.set(k, v);
  let claims;
  try {
    claims = await redeemAuthorizationCode(cfg, callbackUrl, { state, nonce: flow.nonce, codeVerifier: flow.codeVerifier });
  } catch (e) {
    if (e instanceof OidcUnavailableError) {
      log(`auth: ${cfg.label} sign-in unavailable: ${e.message}`);
      return fail('unavailable');
    }
    log(`auth: ${cfg.label} sign-in rejected: ${e instanceof Error ? e.message : String(e)}`);
    return fail('failed');
  }

  if (flow.intent === 'login') {
    const r = await resolveProviderLogin(provider, claims);
    if ('error' in r) return fail(r.error);
    if (await isSuspended(r.userId)) return fail('suspended');
    const done = await completeSignIn(req, res, r.userId, provider, { link: r.link, newAccount: r.created });
    if (r.created && !claims.emailVerified) {
      // The provider didn't vouch for the address: prove it the usual way.
      getAccount(r.userId)
        .then((u) => sendVerification(req, u))
        .catch((e) => logError('auth: could not send the verification email', e));
    }
    if ('twoFactorRequired' in done) return void res.redirect(`/login/two-factor?next=${encodeURIComponent(flow.returnTo)}`);
    return void res.redirect(flow.returnTo);
  }

  // link / reauth: only for the signed-in user who started it.
  const session = await sessionFromCookieHeader(req.headers.cookie);
  if (!session || session.user.id !== flow.userId) return fail('failed');
  if (flow.intent === 'link') {
    const error = await linkProvider(req, session.user.id, provider, claims);
    if (error) return fail(error);
    return void res.redirect(`/settings?connected=${encodeURIComponent(provider)}`);
  }
  if (!(await isConnectedIdentity(session.user.id, provider, claims))) return fail('wrong_account');
  await repo.markSessionAuthenticated(session.key, session.user.id, Date.now());
  res.redirect(flow.returnTo);
}
