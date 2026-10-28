// SAML 2.0 service provider for a workspace, on @node-saml/node-saml (signature, audience,
// timestamps, InResponseTo and replay are validated by the library; we never parse an unverified
// response ourselves). What we add:
// - its cache provider lives in Postgres per workspace (sso_saml_cache), so every instance knows
//   the outstanding requests and the assertions already accepted, and consuming a request ID or
//   recording an assertion ID is one statement (two copies of one response can't both pass);
// - SP-initiated only: validateInResponseTo 'always' refuses unsolicited (IdP-initiated) responses;
// - the verified assertion must be addressed to this workspace's assertion consumer service
//   (bearer SubjectConfirmationData Recipient), which node-saml 5 only warns about;
// - claims are read from the VERIFIED assertion only (`getAssertion()`), never the outer response.
// Metadata parsing (the IdP's entityID, SSO URL and signing certificates) reads public metadata
// with @xmldom/xmldom; it validates nothing cryptographic, it only extracts configuration.
import { X509Certificate } from 'node:crypto';
import { DOMParser } from '@xmldom/xmldom';
import { SAML, ValidateInResponseTo, type CacheProvider, type Profile } from '@node-saml/node-saml';
import { getConfig } from '../../platform/config';
import { badRequest } from '../../platform/http';
import * as repo from './repo';

/** How long an AuthnRequest may wait for its answer (the flow lasts as long). */
export const SAML_REQUEST_TTL_MS = 10 * 60_000;
const CLOCK_SKEW_MS = 60_000;
/** An assertion issued longer ago than this is refused even if the IdP said it is valid longer. */
const MAX_ASSERTION_AGE_MS = 10 * 60_000;

/** node-saml's cache, in sso_saml_cache, scoped to one workspace. */
export function cacheFor(workspaceId: string): CacheProvider {
  return {
    async saveAsync(key, value) {
      const now = Date.now();
      await repo.cacheSave(workspaceId, key, value, now + SAML_REQUEST_TTL_MS);
      return { value, createdAt: now };
    },
    getAsync: (key) => repo.cacheGet(workspaceId, key, Date.now()),
    async removeAsync(key) {
      return key === null ? null : repo.cacheTake(workspaceId, key, Date.now());
    },
    consumeAsync: (key) => repo.cacheTake(workspaceId, key, Date.now()),
    saveIfAbsentAsync: (key, value, expiresAtMs) => repo.cacheSaveIfAbsent(workspaceId, key, value, expiresAtMs, Date.now()),
  };
}

export interface SpUrls {
  /** Our entityID for this workspace (= the metadata URL). */
  entityId: string;
  acsUrl: string;
}

export interface IdpSettings {
  entityId: string;
  ssoUrl: string;
  /** PEM certificates. */
  certs: string[];
}

export function samlFor(workspaceId: string, sp: SpUrls, idp: IdpSettings): SAML {
  return new SAML({
    issuer: sp.entityId,
    callbackUrl: sp.acsUrl,
    audience: sp.entityId,
    entryPoint: idp.ssoUrl,
    idpIssuer: idp.entityId,
    idpCert: idp.certs,
    // The assertion itself must be signed (a signed response around an unsigned assertion is refused);
    // a signed response is accepted on top but not required (Entra and Okta sign the assertion).
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    validateInResponseTo: ValidateInResponseTo.always,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    rejectReplayedAssertions: true,
    cacheProvider: cacheFor(workspaceId),
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    identifierFormat: null, // let the IdP choose (email or persistent); the subject is NameID either way
    disableRequestedAuthnContext: true, // accept MFA / passwordless / Kerberos as the IdP decides
    signatureAlgorithm: 'sha256',
  });
}

// ---- certificates and metadata ----

const PEM_RE = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/g;

/** PEM from a PEM block or bare base64 DER; throws 400 unless it parses as an X.509 certificate. */
export function normalizeCertificate(input: string): string {
  const blocks = [...input.matchAll(PEM_RE)].map((m) => m[1]);
  const bodies = blocks.length ? blocks : [input];
  const out: string[] = [];
  for (const body of bodies) {
    const b64 = body.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) throw badRequest('The certificate is not a PEM or base64 X.509 certificate');
    const pem = `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
    try {
      new X509Certificate(pem);
    } catch {
      throw badRequest('The certificate could not be read as an X.509 certificate');
    }
    out.push(pem);
  }
  return out.join('\n');
}

export function splitCertificates(stored: string | null): string[] {
  return stored ? [...stored.matchAll(PEM_RE)].map((m) => m[0]) : [];
}

export function certificateInfo(pem: string): { subject: string; validTo: string; fingerprint: string } {
  const c = new X509Certificate(pem);
  return { subject: c.subject.replace(/\n/g, ', '), validTo: new Date(c.validTo).toISOString(), fingerprint: c.fingerprint256 };
}

const MD = 'urn:oasis:names:tc:SAML:2.0:metadata';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const REDIRECT_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect';

/** The IdP settings in its metadata XML (the first IDPSSODescriptor). Throws 400 when incomplete. */
export function parseIdpMetadata(xml: string): IdpSettings {
  if (xml.length > 512 * 1024) throw badRequest('The metadata is too large');
  if (/<!DOCTYPE/i.test(xml)) throw badRequest('The metadata must not contain a DOCTYPE');
  const errors: string[] = [];
  const doc = new DOMParser({ errorHandler: (level: string, msg: unknown) => void (level !== 'warning' && errors.push(String(msg))) }).parseFromString(xml, 'text/xml');
  if (errors.length || !doc?.documentElement) throw badRequest('The metadata is not valid XML');
  const descriptor = doc.documentElement.localName === 'EntityDescriptor' ? doc.documentElement : doc.getElementsByTagNameNS(MD, 'EntityDescriptor')[0];
  const entityId = descriptor?.getAttribute('entityID')?.trim();
  const idp = descriptor?.getElementsByTagNameNS(MD, 'IDPSSODescriptor')[0];
  if (!entityId || !idp) throw badRequest('The metadata has no identity provider (IDPSSODescriptor with an entityID)');
  const services = Array.from(idp.getElementsByTagNameNS(MD, 'SingleSignOnService'));
  const sso = services.find((s) => s.getAttribute('Binding') === REDIRECT_BINDING);
  const ssoUrl = sso?.getAttribute('Location')?.trim();
  if (!ssoUrl) throw badRequest('The metadata has no SingleSignOnService with the HTTP-Redirect binding');
  const certs: string[] = [];
  for (const kd of Array.from(idp.getElementsByTagNameNS(MD, 'KeyDescriptor'))) {
    const use = kd.getAttribute('use');
    if (use && use !== 'signing') continue;
    for (const c of Array.from(kd.getElementsByTagNameNS(DS, 'X509Certificate'))) certs.push(normalizeCertificate(c.textContent ?? ''));
  }
  if (!certs.length) throw badRequest('The metadata has no signing certificate');
  return { entityId, ssoUrl: checkHttpsUrl(ssoUrl, 'SingleSignOnService'), certs };
}

/** https (or http outside production — local test IdPs), no credentials. */
export function checkHttpsUrl(v: string, what: string, allowHttp = !getConfig().production): string {
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw badRequest(`${what} must be a URL`);
  }
  if (!(u.protocol === 'https:' || (allowHttp && u.protocol === 'http:')) || u.username || u.password) throw badRequest(`${what} must be an https URL`);
  return u.href;
}

// ---- claims from a verified assertion ----

export interface SamlClaims {
  issuer: string;
  subject: string;
  email: string;
  name: string | null;
  /** The IdP's SessionNotOnOrAfter, if it set one. */
  sessionNotOnOrAfter: number | null;
  inResponseTo: string;
}

const EMAIL_ATTRS = [
  'email',
  'mail',
  'emailaddress',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
];
const DISPLAY_ATTRS = ['displayName', 'name', 'http://schemas.microsoft.com/identity/claims/displayname', 'urn:oid:2.16.840.1.113730.3.1.241'];
const GIVEN_ATTRS = ['firstName', 'givenName', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname', 'urn:oid:2.5.4.42'];
const SURNAME_ATTRS = ['lastName', 'surname', 'sn', 'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname', 'urn:oid:2.5.4.4'];

function attr(profile: Profile, names: string[]): string | null {
  const attrs = (profile.attributes ?? {}) as Record<string, unknown>;
  for (const n of names) {
    const v = attrs[n] ?? profile[n];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s === 'string' && s.trim()) return s.trim();
  }
  return null;
}

type Xml2Js = { $?: Record<string, string>; [k: string]: unknown };
const children = (n: unknown, name: string): Xml2Js[] => {
  const v = (n as Record<string, unknown> | undefined)?.[name];
  return Array.isArray(v) ? (v as Xml2Js[]) : [];
};

const sameUrl = (a: string, b: string) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};

/**
 * Reads the claims from a profile node-saml verified. Throws when the assertion isn't addressed
 * to `acsUrl` or names no usable address.
 */
export function claimsFromProfile(profile: Profile, acsUrl: string): SamlClaims {
  const assertion = profile.getAssertion?.() as { Assertion?: Xml2Js } | undefined;
  const a = assertion?.Assertion;
  if (!a) throw new Error('no verified assertion');
  // Bearer confirmation addressed to this ACS.
  const confirmations = children(children(a, 'Subject')[0], 'SubjectConfirmation');
  const recipients = confirmations
    .filter((c) => c.$?.Method === 'urn:oasis:names:tc:SAML:2.0:cm:bearer')
    .flatMap((c) => children(c, 'SubjectConfirmationData'))
    .map((d) => d.$?.Recipient ?? '');
  if (!recipients.some((r) => sameUrl(r, acsUrl))) throw new Error(`the assertion is addressed to ${recipients.join(', ') || 'no recipient'}, not ${acsUrl}`);
  if (typeof profile.inResponseTo !== 'string') throw new Error('the assertion answers no request');
  const session = children(a, 'AuthnStatement')[0]?.$?.SessionNotOnOrAfter;
  const nameId = profile.nameID;
  const email = attr(profile, EMAIL_ATTRS) ?? (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nameId ?? '') ? nameId : null);
  if (!email) throw new Error('the assertion carries no email address');
  const given = attr(profile, GIVEN_ATTRS);
  const surname = attr(profile, SURNAME_ATTRS);
  const name = attr(profile, DISPLAY_ATTRS) ?? ([given, surname].filter(Boolean).join(' ') || null);
  return {
    issuer: profile.issuer,
    subject: nameId,
    email: email.toLowerCase(),
    name,
    sessionNotOnOrAfter: session ? Date.parse(session) || null : null,
    inResponseTo: profile.inResponseTo,
  };
}
