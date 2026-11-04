// The SSO browser flows (service-provider initiated, and SAML started at the identity provider
// where the workspace allows it):
//
//   GET  /api/sso/:ws/start          -> remembers the request (sso_flows, bound to this browser by an
//                                       HttpOnly cookie) and redirects to the identity provider
//   SAML POST /api/sso/:ws/saml/acs  <- the IdP's page posts the signed response (cross-site, so no
//                                       cookies arrive): node-saml validates it, the claims are parked
//                                       on the flow its InResponseTo names, 303 to …/saml/finish
//   SAML GET  /api/sso/:ws/saml/finish -> same-site, carries the cookie: only the browser that
//                                       started the flow can finish it (no login CSRF / fixation)
//   OIDC GET  /api/sso/:ws/oidc/callback -> cookie + state, then auth's OIDC client redeems the code
//   SAML IdP-initiated (#107): the IdP's app tile posts an UNSOLICITED response (no InResponseTo) to
//                                       the ACS. Only with the connection's `idpInitiated` on (else
//                                       /login?error=sso_unsolicited); its Destination must be this ACS;
//                                       the assertion ID is remembered until its NotOnOrAfter (one
//                                       use); the claims are parked on a new flow bound to the browser
//                                       that posted (cookie set on that answer) and finished by the same
//                                       …/saml/finish; RelayState counts only as a same-origin path.
//
//   #13: with a service-provider key pair, AuthnRequests are signed ("Sign requests") and
//   encrypted assertions are decrypted (each key tried: rotation); "Require encrypted assertions"
//   refuses one that arrived in the clear before anything is validated. The sign-in's IdP session
//   (NameID, SessionIndex) rides along to the session it opens (sessionTag → logout.ts), so the
//   IdP's single logout can end exactly it.
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
import { recordAudit, recordAuditQuietly } from '../audit/index';
import { applyDirectoryMembership, isDeactivatedMember } from '../workspaces/index';
import { CLIENT_SECRET_PURPOSE, serviceProviderUrls, ssoMethod } from './connections';
import { domainOf, isOrganizationEmail } from './domains';
import * as repo from './repo';
import { claimsFromProfile, responseAssertionKind, responseDestination, SAML_REQUEST_TTL_MS, sameAcs, samlFor, splitCertificates, type SpKeyUse } from './saml';
import { usableKeys } from './spKeys';

const COOKIE = 'freero_sso';
const COOKIE_PATH = '/api/sso';
/** An IdP-initiated sign-in's parked claims wait this long for the redirect that finishes it. */
const UNSOLICITED_TTL_MS = 2 * 60_000;
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

const fail = (res: Response, code: OidcErrorCode) => res.redirect(303, `/login?error=${code}`);

function bindBrowser(req: Request, res: Response, maxAge = SAML_REQUEST_TTL_MS): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', path: COOKIE_PATH, maxAge, secure: getConfig().production && req.secure });
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

/**
 * The connection's SAML service provider: one per decryption key (the current key first; a single
 * one without keys), each signing with the current key when "Sign requests" is on.
 */
export async function samlOf(req: Request | null, c: repo.ConnectionRecord, requestId?: string) {
  if (!c.samlEntityId || !c.samlSsoUrl || !c.samlCerts) return null;
  const sp = serviceProviderUrls(req, c.workspaceId);
  const keys = await usableKeys(c.workspaceId);
  const signingKey = c.signRequests ? (keys.find((k) => k.current)?.privateKeyPem ?? null) : null;
  // Signing was asked for and the key can't be opened: refuse rather than send unsigned requests.
  if (c.signRequests && !signingKey) return null;
  const idp = { entityId: c.samlEntityId, ssoUrl: c.samlSsoUrl, certs: splitCertificates(c.samlCerts), sloUrl: c.samlSloUrl };
  const make = (use: SpKeyUse) => {
    const saml = samlFor(c.workspaceId, { entityId: sp.entityId, acsUrl: sp.acsUrl }, idp, { signingKey, sloUrl: sp.sloUrl, ...use });
    if (requestId) saml.options.generateUniqueId = () => requestId;
    return saml;
  };
  const all = keys.length ? keys.map((k) => make({ decryptionKey: k.privateKeyPem })) : [make({})];
  return { saml: all[0], all, acsUrl: sp.acsUrl, sloUrl: sp.sloUrl };
}

/** GET /api/sso/:workspaceId/start */
export async function startSso(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const c = await repo.getConnection(workspaceId);
  if (!c || !c.enabled) return void fail(res, 'sso_unavailable');
  // No particular destination: the dashboard of the workspace they signed in to.
  const next = safeReturnPath(req.query.next, '/app');
  const returnTo = next === '/app' ? `/app?ws=${encodeURIComponent(workspaceId)}` : next;
  const hint = typeof req.query.login_hint === 'string' ? req.query.login_hint.slice(0, 254) : '';
  const now = Date.now();
  const flowId = newId(24);
  if (c.protocol === 'saml') {
    const requestId = `_${randomBytes(20).toString('hex')}`;
    const s = await samlOf(req, c, requestId);
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
  /** SAML started at the identity provider (its app tile), for the audit log. */
  idpInitiated?: boolean;
  /** SAML (#13): the IdP's session this sign-in belongs to, for single logout. */
  samlSession?: SamlSessionTag['saml'];
}

/** What a SAML sign-in tells the session it opens (auth's opaque `sessionTag`; logout.ts reads it). */
export interface SamlSessionTag {
  saml: { workspaceId?: string; nameId: string; nameIdFormat: string | null; sessionIndex: string | null };
}
/**
 * Where an IdP-initiated sign-in lands: its RelayState only when that is a plain same-origin path
 * (no scheme, host, protocol-relative `//`, backslash, whitespace or control character), else the
 * workspace's dashboard — never an open redirect.
 */
export function unsolicitedReturnPath(relay: string, workspaceId: string): string {
  const dashboard = `/app?ws=${encodeURIComponent(workspaceId)}`;
  // eslint-disable-next-line no-control-regex
  if (relay.length > 2000 || !/^\/(?![/\\])[^\s\\\u0000-\u001f\u007f]*$/.test(relay)) return dashboard;
  // Back into the API (another sign-in, a logout) is not a destination.
  if (/^\/api(\/|$)/i.test(relay)) return dashboard;
  return safeReturnPath(relay, dashboard);
}

/** POST /api/sso/:workspaceId/saml/acs — the identity provider's page posts here (cross-site). */
export async function samlAcs(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const body = (req.body ?? {}) as Record<string, unknown>;
  const response = typeof body.SAMLResponse === 'string' ? body.SAMLResponse : '';
  const relay = typeof body.RelayState === 'string' ? body.RelayState : '';
  const c = await repo.getConnection(workspaceId);
  if (!c || !c.enabled || c.protocol !== 'saml') return void fail(res, 'sso_unavailable');
  const s = await samlOf(req, c);
  if (!s || !response) return void fail(res, 'sso_failed');
  const kind = responseAssertionKind(response);
  // Decryption is not authentication (the signature inside is still required), but an IdP set up to
  // encrypt that suddenly sends the clear is either misconfigured or not the IdP.
  if (c.requireEncrypted && kind !== 'encrypted') {
    await refused(workspaceId, 'a SAML assertion that was not encrypted, which this workspace requires');
    return void fail(res, 'sso_failed');
  }
  let claims: ReturnType<typeof claimsFromProfile>;
  try {
    let profile = null;
    // An encrypted assertion is tried with each key (rotation: the IdP may still use the previous
    // certificate). Nothing is consumed before decryption, so a wrong key costs only the attempt.
    const candidates = kind === 'encrypted' ? s.all : [s.saml];
    let firstError: unknown = null;
    for (const candidate of candidates) {
      try {
        profile = (await candidate.validatePostResponseAsync({ SAMLResponse: response })).profile;
        firstError = null;
        break;
      } catch (e) {
        firstError ??= e; // the current key's reason is the one worth recording
      }
    }
    if (firstError) throw firstError;
    if (!profile) throw new Error('not a sign-in response');
    claims = claimsFromProfile(profile, s.acsUrl);
  } catch (e) {
    await refused(workspaceId, `SAML response: ${e instanceof Error ? e.message : String(e)}`);
    return void fail(res, 'sso_failed');
  }
  const parked: DirectoryClaims = {
    issuer: claims.issuer,
    subject: claims.subject,
    email: claims.email,
    name: claims.name,
    sessionNotOnOrAfter: claims.sessionNotOnOrAfter,
    samlSession: { nameId: claims.subject, nameIdFormat: claims.nameIdFormat, sessionIndex: claims.sessionIndex },
  };
  if (claims.inResponseTo === null) {
    // Unsolicited: the identity provider started this sign-in (its app tile). The library has
    // checked signature, audience, Recipient, timestamps and recorded the assertion ID (replay).
    if (!c.idpInitiated) {
      await refused(workspaceId, 'an IdP-initiated sign-in (unsolicited SAML response), which this workspace does not allow', { email: claims.email });
      return void fail(res, 'sso_unsolicited');
    }
    const destination = responseDestination(response);
    if (!destination || !sameAcs(destination, s.acsUrl)) {
      await refused(workspaceId, `an IdP-initiated SAML response addressed to ${destination ?? 'no Destination'}, not this ACS`, { email: claims.email });
      return void fail(res, 'sso_failed');
    }
    const flowId = newId(24);
    const now = Date.now();
    await repo.insertAnsweredSamlFlow(
      { id: flowId, workspaceId, browserHash: bindBrowser(req, res, UNSOLICITED_TTL_MS), returnTo: unsolicitedReturnPath(relay, workspaceId) },
      { ...parked, idpInitiated: true } satisfies DirectoryClaims,
      now,
      now + UNSOLICITED_TTL_MS,
    );
    return void res.redirect(303, `/api/sso/${encodeURIComponent(workspaceId)}/saml/finish?flow=${encodeURIComponent(flowId)}`);
  }
  // The RelayState names the flow; it must be the one that sent the request this answers.
  if (!relay || !(await repo.recordSamlResult(workspaceId, relay, claims.inResponseTo, parked, Date.now()))) {
    await refused(workspaceId, 'a SAML response for no pending sign-in of this flow (RelayState)', { email: claims.email });
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
    await refused(workspaceId, `OpenID Connect: ${e instanceof Error ? e.message : String(e)}`);
    return void fail(res, e instanceof OidcUnavailableError ? 'sso_unavailable' : 'sso_failed');
  }
  if (!claims.email) return void fail(res, 'no_email');
  await completeDirectorySignIn(req, res, c, { ...claims, email: claims.email.toLowerCase(), sessionNotOnOrAfter: null }, flow.returnTo);
}

/**
 * A refused SSO answer, in the workspace's log (nobody is signed in: no actor). Never fails the
 * response. `email` only when the IdP's signature was verified (otherwise it is anyone's claim).
 */
function refused(workspaceId: string, reason: string, who: { userId?: string; email?: string } = {}): Promise<void> {
  log(`sso: workspace ${workspaceId} refused a sign-in: ${reason}`);
  return recordAuditQuietly({
    action: 'sso.login_refused',
    workspaceId,
    actorId: null,
    target: who.userId || who.email ? { type: 'user', id: who.userId ?? who.email!, label: who.email ?? null } : null,
    metadata: { reason: reason.slice(0, 300) },
  });
}

async function completeDirectorySignIn(req: Request, res: Response, c: repo.ConnectionRecord, claims: DirectoryClaims, returnTo: string): Promise<void> {
  const workspaceId = c.workspaceId;
  // The IdP is the authority only for addresses at the workspace's verified domains: anything else
  // (a misconfigured or hostile IdP asserting someone@gmail.com) never reaches an account.
  if (!(await isOrganizationEmail(workspaceId, claims.email))) {
    await refused(workspaceId, `the identity provider asserted an address at ${domainOf(claims.email)}, which this workspace has not verified`, { email: claims.email });
    return void fail(res, 'sso_domain');
  }
  const method = ssoMethod(workspaceId);
  const r = await resolveDirectoryLogin(method, claims);
  // Deactivated here (by an admin or the directory): this workspace doesn't sign them in.
  if (await isDeactivatedMember(workspaceId, r.userId)) {
    await refused(workspaceId, 'deactivated in this workspace', { userId: r.userId, email: claims.email });
    return void fail(res, 'sso_removed');
  }
  const target = { type: 'user', id: r.userId, label: claims.email };
  await applyDirectoryMembership(workspaceId, r.userId, c.defaultRole, {
    overwrite: false,
    onJoined: (role) =>
      recordAudit({ action: 'sso.member_provisioned', workspaceId, actorId: r.userId, target, metadata: { role, newAccount: r.created } }),
  });
  // The session belongs to the person: the strictest session policy of their teams applies to it
  // (auth). Only the IdP's own end of this sign-in (SAML SessionNotOnOrAfter) shortens it further.
  const sessionExpiresAt = claims.sessionNotOnOrAfter;
  let done;
  try {
    const sessionTag = claims.samlSession ? JSON.stringify({ saml: { ...claims.samlSession, workspaceId } } satisfies SamlSessionTag) : null;
    done = await completeSignIn(req, res, r.userId, method, { link: r.link, newAccount: r.created, sessionExpiresAt, sessionTag });
  } catch (e) {
    if (!(e instanceof HttpError) || e.status >= 500) throw e;
    await refused(workspaceId, e.message, { userId: r.userId, email: claims.email });
    return void fail(res, e.code === SSO_REQUIRED ? 'sso_required' : 'sso_failed');
  }
  await repo.markTested(workspaceId, Date.now());
  await recordAuditQuietly({
    action: 'sso.login',
    workspaceId,
    actorId: r.userId,
    target,
    metadata: {
      protocol: c.protocol,
      enforced: c.enforced,
      newAccount: r.created,
      secondStepPending: 'twoFactorRequired' in done,
      initiatedBy: claims.idpInitiated ? 'identity_provider' : 'freero',
    },
  });
  if ('twoFactorRequired' in done) return void res.redirect(303, `/login/two-factor?next=${encodeURIComponent(returnTo)}`);
  res.redirect(303, returnTo);
}
