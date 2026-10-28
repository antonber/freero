// The SSO browser flows (service-provider initiated only):
//
//   GET  /api/sso/:ws/start          -> remembers the request (sso_flows, bound to this browser by an
//                                       HttpOnly cookie) and redirects to the identity provider
//   SAML POST /api/sso/:ws/saml/acs  <- the IdP's page posts the signed response (cross-site, so no
//                                       cookies arrive): node-saml validates it, the claims are parked
//                                       on the flow its InResponseTo names, 303 to …/saml/finish
//   SAML GET  /api/sso/:ws/saml/finish -> same-site, carries the cookie: only the browser that
//                                       started the flow can finish it (no login CSRF / fixation)
//   OIDC GET  /api/sso/:ws/oidc/callback -> cookie + state, then auth's OIDC client redeems the code
//
// Both end in completeDirectorySignIn: the address must be at a domain the workspace verified, the
// account is resolved (auth.resolveDirectoryLogin), a deprovisioned person is refused, a newcomer
// joins with the default role (just in time), and auth.completeSignIn opens the session (second
// step when the account has one) capped at the IdP's session lifetime.
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { SSO_REQUIRED, type OidcErrorCode } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { HttpError, parseCookies } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log } from '../../platform/log';
import { seal, unseal } from '../../platform/secrets';
import {
  completeSignIn,
  newOidcChecks,
  oidcAuthorizationUrl,
  OidcUnavailableError,
  redeemOidcCode,
  resolveDirectoryLogin,
  safeReturnPath,
  type OidcClientConfig,
} from '../auth/index';
import { applyDirectoryMembership } from '../workspaces/index';
import { CLIENT_SECRET_PURPOSE, serviceProviderUrls, ssoMethod } from './connections';
import { domainOf, isOrganizationEmail } from './domains';
import { joinRefusal } from './policy';
import * as repo from './repo';
import { claimsFromProfile, SAML_REQUEST_TTL_MS, samlFor, splitCertificates } from './saml';

const COOKIE = 'freero_sso';
const COOKIE_PATH = '/api/sso';
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const fail = (res: Response, code: OidcErrorCode) => res.redirect(303, `/login?error=${code}`);

function bindBrowser(req: Request, res: Response): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: COOKIE_PATH, maxAge: SAML_REQUEST_TTL_MS, secure: getConfig().production && req.secure });
  return sha256(token);
}

/** The browser binding this request carries (sha256 of the cookie), or null; the cookie is cleared. */
function browserOf(req: Request, res: Response): string | null {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  res.clearCookie(COOKIE, { path: COOKIE_PATH });
  return token ? sha256(token) : null;
}

function oidcConfigOf(c: repo.ConnectionRecord): OidcClientConfig | null {
  const secret = c.oidcClientSecret ? unseal(CLIENT_SECRET_PURPOSE, c.oidcClientSecret) : null;
  if (!c.oidcIssuer || !c.oidcClientId || !secret) return null;
  if (secret.stale && c.oidcClientSecret) void repo.resealClientSecret(c.workspaceId, c.oidcClientSecret, sealAgain(secret.value)).catch(() => {});
  return { issuer: c.oidcIssuer, clientId: c.oidcClientId, clientSecret: secret.value };
}

const sealAgain = (v: string) => seal(CLIENT_SECRET_PURPOSE, v);

function samlOf(req: Request, c: repo.ConnectionRecord, requestId?: string) {
  if (!c.samlEntityId || !c.samlSsoUrl || !c.samlCerts) return null;
  const sp = serviceProviderUrls(req, c.workspaceId);
  const saml = samlFor(c.workspaceId, { entityId: sp.entityId, acsUrl: sp.acsUrl }, { entityId: c.samlEntityId, ssoUrl: c.samlSsoUrl, certs: splitCertificates(c.samlCerts) });
  if (requestId) saml.options.generateUniqueId = () => requestId;
  return { saml, acsUrl: sp.acsUrl };
}

/** GET /api/sso/:workspaceId/start */
export async function startSso(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const c = await repo.getConnection(workspaceId);
  if (!c || !c.enabled) return void fail(res, 'sso_unavailable');
  const returnTo = safeReturnPath(req.query.next, '/app');
  const hint = typeof req.query.login_hint === 'string' ? req.query.login_hint.slice(0, 254) : '';
  const now = Date.now();
  const flowId = newId(24);
  if (c.protocol === 'saml') {
    const requestId = `_${randomBytes(20).toString('hex')}`;
    const s = samlOf(req, c, requestId);
    if (!s) return void fail(res, 'sso_unavailable');
    // node-saml records the request ID (sso_saml_cache) for InResponseTo.
    const url = await s.saml.getAuthorizeUrlAsync(flowId, hint ? { additionalParams: { login_hint: hint } } : {});
    await repo.insertFlow(
      { id: flowId, workspaceId, protocol: 'saml', browserHash: bindBrowser(req, res), stateHash: null, requestId, nonce: null, codeVerifier: null, returnTo },
      now,
      now + SAML_REQUEST_TTL_MS,
    );
    return void res.redirect(url);
  }
  const cfg = oidcConfigOf(c);
  if (!cfg) return void fail(res, 'sso_unavailable');
  const checks = newOidcChecks();
  let url: string;
  try {
    url = await oidcAuthorizationUrl(cfg, serviceProviderUrls(req, workspaceId).oidcRedirectUri, checks);
  } catch (e) {
    if (!(e instanceof OidcUnavailableError)) throw e;
    log(`sso: workspace ${workspaceId}'s OpenID provider is unavailable: ${e.message}`);
    return void fail(res, 'sso_unavailable');
  }
  if (hint) {
    const u = new URL(url);
    u.searchParams.set('login_hint', hint);
    url = u.href;
  }
  await repo.insertFlow(
    {
      id: flowId,
      workspaceId,
      protocol: 'oidc',
      browserHash: bindBrowser(req, res),
      stateHash: sha256(checks.state),
      requestId: null,
      nonce: checks.nonce,
      codeVerifier: checks.codeVerifier,
      returnTo,
    },
    now,
    now + SAML_REQUEST_TTL_MS,
  );
  res.redirect(url);
}

interface DirectoryClaims {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
  sessionNotOnOrAfter: number | null;
}

/** POST /api/sso/:workspaceId/saml/acs — the identity provider's page posts here (cross-site). */
export async function samlAcs(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const response = typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
  const relay = typeof body.RelayState === 'string' ? body.RelayState : '';
  const c = await repo.getConnection(workspaceId);
  if (!c || !c.enabled || c.protocol !== 'saml') return void fail(res, 'sso_unavailable');
  const s = samlOf(req, c);
  if (!s || !response) return void fail(res, 'sso_failed');
  let claims: ReturnType<typeof claimsFromProfile>;
  try {
    const { profile } = await s.saml.validatePostResponseAsync({ SAMLResponse: response });
    if (!profile) throw new Error('not a sign-in response');
    claims = claimsFromProfile(profile, s.acsUrl);
  } catch (e) {
    log(`sso: workspace ${workspaceId} refused a SAML response: ${e instanceof Error ? e.message : String(e)}`);
    return void fail(res, 'sso_failed');
  }
  const parked: DirectoryClaims = {
    issuer: claims.issuer,
    subject: claims.subject,
    email: claims.email,
    name: claims.name,
    sessionNotOnOrAfter: claims.sessionNotOnOrAfter,
  };
  // The RelayState names the flow; it must be the one that sent the request this answers.
  if (!relay || !(await repo.recordSamlResult(workspaceId, relay, claims.inResponseTo, parked, Date.now()))) {
    log(`sso: workspace ${workspaceId} got a SAML response for no pending sign-in of this flow`);
    return void fail(res, 'sso_failed');
  }
  res.redirect(303, `/api/sso/${encodeURIComponent(workspaceId)}/saml/finish?flow=${encodeURIComponent(relay)}`);
}

/** GET /api/sso/:workspaceId/saml/finish — same-site: only the browser that started the flow gets in. */
export async function samlFinish(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const browser = browserOf(req, res);
  const flowId = typeof req.query.flow === 'string' ? req.query.flow : '';
  const flow = browser && flowId ? await repo.takeSamlFlow(workspaceId, flowId, browser, Date.now()) : null;
  if (!flow) return void fail(res, 'sso_failed');
  const c = await repo.getConnection(workspaceId);
  if (!c || !c.enabled) return void fail(res, 'sso_unavailable');
  await completeDirectorySignIn(req, res, c, flow.result as DirectoryClaims, flow.returnTo);
}

const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** GET /api/sso/:workspaceId/oidc/callback */
export async function oidcCallback(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const browser = browserOf(req, res);
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  const flow = browser && state ? await repo.takeOidcFlow(workspaceId, sha256(state), browser, Date.now()) : null;
  if (!flow || !flow.stateHash || !sameHash(flow.stateHash, sha256(state))) return void fail(res, 'sso_failed');
  if (typeof req.query.error === 'string') return void fail(res, req.query.error === 'access_denied' ? 'cancelled' : 'sso_failed');
  const c = await repo.getConnection(workspaceId);
  const cfg = c && c.enabled && c.protocol === 'oidc' ? oidcConfigOf(c) : null;
  if (!c || !cfg) return void fail(res, 'sso_unavailable');
  const callbackUrl = new URL(serviceProviderUrls(req, workspaceId).oidcRedirectUri);
  for (const [k, v] of Object.entries(req.query)) if (typeof v === 'string') callbackUrl.searchParams.set(k, v);
  let claims;
  try {
    claims = await redeemOidcCode(cfg, callbackUrl, { state, nonce: flow.nonce ?? '', codeVerifier: flow.codeVerifier ?? '' });
  } catch (e) {
    log(`sso: workspace ${workspaceId} refused an OpenID sign-in: ${e instanceof Error ? e.message : String(e)}`);
    return void fail(res, e instanceof OidcUnavailableError ? 'sso_unavailable' : 'sso_failed');
  }
  if (!claims.email) return void fail(res, 'no_email');
  await completeDirectorySignIn(req, res, c, { ...claims, email: claims.email.toLowerCase(), sessionNotOnOrAfter: null }, flow.returnTo);
}

async function completeDirectorySignIn(req: Request, res: Response, c: repo.ConnectionRecord, claims: DirectoryClaims, returnTo: string): Promise<void> {
  const workspaceId = c.workspaceId;
  // The IdP is the authority only for addresses at the workspace's verified domains: anything else
  // (a misconfigured or hostile IdP asserting someone@gmail.com) never reaches an account.
  if (!(await isOrganizationEmail(workspaceId, claims.email))) {
    log(`sso: workspace ${workspaceId}'s identity provider asserted an address at ${domainOf(claims.email)}, which it has not verified`);
    return void fail(res, 'sso_domain');
  }
  const method = ssoMethod(workspaceId);
  const r = await resolveDirectoryLogin(method, claims);
  const refused = await joinRefusal(workspaceId, r.userId);
  if (refused) {
    log(`sso: workspace ${workspaceId} refused ${r.userId}: ${refused}`);
    return void fail(res, 'sso_removed');
  }
  await applyDirectoryMembership(workspaceId, r.userId, c.defaultRole, { overwrite: false });
  const now = Date.now();
  const sessionExpiresAt = Math.min(now + c.sessionHours * 3_600_000, claims.sessionNotOnOrAfter ?? Infinity);
  let done;
  try {
    done = await completeSignIn(req, res, r.userId, method, { link: r.link, newAccount: r.created, sessionExpiresAt });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status >= 500) throw e;
    log(`sso: workspace ${workspaceId} could not finish ${r.userId}'s sign-in: ${e.message}`);
    return void fail(res, e.code === SSO_REQUIRED ? 'sso_required' : 'sso_failed');
  }
  await repo.markTested(workspaceId, now);
  // AUDIT(KAI-48): emit `sso.sign_in` { workspaceId, userId, protocol: c.protocol, enforced: c.enforced, jit: r.created } once the audit log lands.
  log(`sso: ${r.userId} signed in through workspace ${workspaceId}'s ${c.protocol} provider${c.enforced ? ' (enforced)' : ''}${r.created ? ' (new account)' : ''}`);
  if ('twoFactorRequired' in done) return void res.redirect(303, `/login/two-factor?next=${encodeURIComponent(returnTo)}`);
  res.redirect(303, returnTo);
}
