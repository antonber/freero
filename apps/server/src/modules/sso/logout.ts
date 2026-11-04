// SAML single logout (#13).
//
//   GET|POST /api/sso/:ws/saml/slo  <- LogoutRequest from the IdP (someone signed out there, or
//                                      at another of its apps): ends the Freero sessions this
//                                      workspace's SAML sign-in started for that NameID (and
//                                      SessionIndex, when it names one), then answers a
//                                      LogoutResponse to the IdP's SingleLogoutService.
//                                   <- LogoutResponse to the LogoutRequest we sent at sign-out:
//                                      lands on /login (the session here is already gone).
//   sign-out here (auth's onSignOutRedirect): a session a SAML sign-in started, on a connection
//                                      with an IdP single logout URL, goes on to the IdP with a
//                                      LogoutRequest naming that NameID / SessionIndex.
//
// What makes an IdP-initiated logout count (it ends sessions, so it is a credential like a
// sign-in response):
// - its signature verifies against the IdP's certificates — over the original query string for
//   the redirect binding (node-saml's one-argument validateRedirectAsync, which refuses a missing
//   Signature — its deprecated two-argument form doesn't, so we check that one is there too), or
//   over the document for HTTP-POST;
// - its Issuer is the connection's IdP (node-saml), its NotOnOrAfter hasn't passed (node-saml);
// - its Destination is this workspace's SLO endpoint (a LogoutRequest the IdP signed for another
//   service provider can't sign people out here), its IssueInstant is recent, and its ID is used
//   once (sso_saml_cache, shared by instances; one statement) — so a captured request can't be
//   replayed;
// - it ends only sessions in sso_sessions for this workspace and that NameID — never a password,
//   personal-provider or other workspace's session of the same person — through auth's
//   endSessionsByKeys (their sockets close on every instance).
import type { Request, Response } from 'express';
import type { Profile } from '@node-saml/node-saml';
import { inflateRawSync } from 'node:zlib';
import { log } from '../../platform/log';
import { endSessionsByKeys, type StartedSession } from '../auth/index';
import { recordAuditQuietly } from '../audit/index';
import * as repo from './repo';
import { logoutMessageAttributes, sameAcs } from './saml';
import { samlOf, type SamlSessionTag } from './signIn';

/** A LogoutRequest issued longer ago than this is refused (and its ID remembered this long). */
const MAX_LOGOUT_AGE_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;

const done = (res: Response, path = '/login') => res.redirect(303, path);

/** The message of a redirect-binding query (inflated), or null. */
function redirectMessage(query: string, param: 'SAMLRequest' | 'SAMLResponse'): string | null {
  const v = new URLSearchParams(query).get(param);
  if (!v) return null;
  try {
    return inflateRawSync(Buffer.from(v, 'base64')).toString('utf8');
  } catch {
    return null;
  }
}

function refused(workspaceId: string, reason: string): Promise<void> {
  log(`sso: workspace ${workspaceId} refused a single logout message: ${reason}`);
  return recordAuditQuietly({ action: 'sso.logout_refused', workspaceId, actorId: null, target: { type: 'sso', id: workspaceId }, metadata: { reason: reason.slice(0, 300) } });
}

/** GET (HTTP-Redirect) and POST (HTTP-POST) /api/sso/:workspaceId/saml/slo */
export async function samlSlo(req: Request, res: Response): Promise<void> {
  const workspaceId = req.params.workspaceId;
  const c = await repo.getConnection(workspaceId);
  if (!c || !c.enabled || c.protocol !== 'saml') return void done(res);
  const s = await samlOf(req, c);
  if (!s) return void done(res);
  const post = req.method === 'POST';
  const body = (req.body ?? {}) as Record<string, unknown>;
  const originalQuery = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?') + 1) : '';
  const params = new URLSearchParams(originalQuery);
  const isRequest = post ? typeof body.SAMLRequest === 'string' : params.has('SAMLRequest');
  const isResponse = post ? typeof body.SAMLResponse === 'string' : params.has('SAMLResponse');
  if (isRequest === isResponse) return void done(res); // neither, or both: not a logout message

  if (isResponse) return void (await logoutResponse(workspaceId, s, post ? String(body.SAMLResponse) : originalQuery, post, res));

  // ---- an IdP-initiated LogoutRequest ----
  let profile: Profile | null;
  let relayState = '';
  let xml: string | null;
  try {
    if (post) {
      xml = Buffer.from(String(body.SAMLRequest), 'base64').toString('utf8');
      profile = (await s.saml.validatePostRequestAsync({ SAMLRequest: String(body.SAMLRequest) })).profile;
      relayState = typeof body.RelayState === 'string' ? body.RelayState : '';
    } else {
      // Exactly one signature, whatever the library's form of the call does with none.
      if (params.getAll('Signature').length !== 1 || params.getAll('SigAlg').length !== 1) throw new Error('the LogoutRequest is not signed');
      xml = redirectMessage(originalQuery, 'SAMLRequest');
      const r = await s.saml.validateRedirectAsync(originalQuery);
      profile = r.profile;
      relayState = r.relayState ?? '';
    }
    if (!profile || !profile.nameID) throw new Error('not a logout request');
    const attrs = xml ? logoutMessageAttributes(xml) : null;
    if (!attrs || attrs.kind !== 'LogoutRequest' || !attrs.id || attrs.id !== profile.ID) throw new Error('unreadable LogoutRequest');
    if (!attrs.destination || !sameAcs(attrs.destination, s.sloUrl)) throw new Error(`a LogoutRequest addressed to ${attrs.destination ?? 'no Destination'}, not this workspace`);
    const now = Date.now();
    if (!attrs.issueInstant || attrs.issueInstant < now - MAX_LOGOUT_AGE_MS || attrs.issueInstant > now + CLOCK_SKEW_MS) throw new Error('a LogoutRequest issued too long ago (or in the future)');
    if (!(await repo.cacheSaveIfAbsent(workspaceId, `slo:${attrs.id}`, '1', attrs.issueInstant + MAX_LOGOUT_AGE_MS + CLOCK_SKEW_MS, now)))
      throw new Error('a LogoutRequest that was already used (replay)');
  } catch (e) {
    await refused(workspaceId, `LogoutRequest: ${e instanceof Error ? e.message : String(e)}`);
    return void done(res, '/login?error=sso_failed');
  }

  const sessionIndex = typeof profile.sessionIndex === 'string' && profile.sessionIndex ? profile.sessionIndex : null;
  const ended = await endSessionsByKeys(await repo.samlSessionKeys(workspaceId, profile.nameID, sessionIndex));
  for (const userId of new Set(ended.map((e) => e.userId)))
    await recordAuditQuietly({
      action: 'sso.logout',
      workspaceId,
      actorId: userId,
      target: { type: 'user', id: userId },
      metadata: { initiatedBy: 'identity_provider', sessionsEnded: ended.filter((e) => e.userId === userId).length, sessionIndex: sessionIndex !== null },
    });
  if (!ended.length)
    await recordAuditQuietly({ action: 'sso.logout', workspaceId, actorId: null, target: { type: 'sso', id: workspaceId }, metadata: { initiatedBy: 'identity_provider', sessionsEnded: 0 } });
  // The answer goes back to the IdP's single logout service (signed when "Sign requests" is on).
  if (!c.samlSloUrl) return void done(res);
  res.redirect(303, await s.saml.getLogoutResponseUrlAsync(profile, relayState, {}, true));
}

async function logoutResponse(workspaceId: string, s: NonNullable<Awaited<ReturnType<typeof samlOf>>>, message: string, post: boolean, res: Response): Promise<void> {
  // The session here ended before the browser was sent to the IdP; this only closes the loop (the
  // InResponseTo is one we sent, once) and lands the browser on the sign-in page either way.
  try {
    if (post) await s.saml.validatePostResponseAsync({ SAMLResponse: message });
    else {
      if (!new URLSearchParams(message).has('Signature')) throw new Error('the LogoutResponse is not signed');
      await s.saml.validateRedirectAsync(message);
    }
  } catch (e) {
    await refused(workspaceId, `LogoutResponse: ${e instanceof Error ? e.message : String(e)}`);
  }
  done(res, '/login');
}

/** auth's onSessionStarted: remembers which IdP session a SAML sign-in's session belongs to. */
export async function recordSamlSession(s: StartedSession): Promise<void> {
  if (!s.tag) return;
  let tag: SamlSessionTag | null = null;
  try {
    tag = JSON.parse(s.tag) as SamlSessionTag;
  } catch {
    return; // not ours
  }
  const saml = tag?.saml;
  if (!saml?.workspaceId || typeof saml.nameId !== 'string' || !saml.nameId) return;
  await repo.insertSamlSession({ sessionKey: s.key, workspaceId: saml.workspaceId, nameId: saml.nameId, nameIdFormat: saml.nameIdFormat ?? null, sessionIndex: saml.sessionIndex ?? null }, Date.now());
}

/**
 * auth's onSignOutRedirect: a session a SAML sign-in started, on a connection with the IdP's single
 * logout URL, goes on to the IdP with a LogoutRequest (signed with "Sign requests"). Asked just
 * before auth deletes the session (the row goes with it).
 */
export async function samlSignOutRedirect(sessionKey: string, req: Request): Promise<string | null> {
  const session = await repo.getSamlSession(sessionKey);
  if (!session) return null;
  const c = await repo.getConnection(session.workspaceId);
  if (!c || !c.enabled || c.protocol !== 'saml' || !c.samlSloUrl) return null;
  const s = await samlOf(req, c);
  if (!s) return null;
  const url = await s.saml.getLogoutUrlAsync(
    { issuer: c.samlEntityId ?? '', nameID: session.nameId, nameIDFormat: session.nameIdFormat ?? 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified', ...(session.sessionIndex ? { sessionIndex: session.sessionIndex } : {}) },
    '',
    {},
  );
  await recordAuditQuietly({ action: 'sso.logout', workspaceId: session.workspaceId, actorId: null, target: { type: 'sso', id: session.workspaceId }, metadata: { initiatedBy: 'freero' } });
  return url;
}
