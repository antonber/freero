// SAML 2.0 service provider for a workspace, on @node-saml/node-saml (signature, audience,
// timestamps, InResponseTo and replay are validated by the library; we never parse an unverified
// response ourselves). What we add:
// - its cache provider lives in Postgres per workspace (sso_saml_cache), so every instance knows
//   the outstanding requests and the assertions already accepted, and consuming a request ID or
//   recording an assertion ID is one statement (two copies of one response can't both pass);
// - validateInResponseTo 'ifPresent': a response that names a request must answer one we sent, once;
//   one that names none (IdP-initiated, from the IdP's app tile) passes the library's checks and is
//   then accepted only where the workspace allows it (signIn.ts samlAcs), with its Destination
//   required to be this ACS. Which kind it is comes from the VERIFIED InResponseTo only (a signed
//   Response's, else the signed assertion's SubjectConfirmationData), never the unsigned envelope;
// - the verified assertion must be addressed to this workspace's assertion consumer service
//   (bearer SubjectConfirmationData Recipient), which node-saml 5 only warns about;
// - claims are read from the VERIFIED assertion only (`getAssertion()`), never the outer response.
// Metadata parsing (the IdP's entityID, SSO URL, single logout URL and signing certificates) reads
// public metadata with @xmldom/xmldom; it validates nothing cryptographic, it only extracts
// configuration.
// #13: with the workspace's SP key pairs (spKeys.ts) node-saml decrypts encrypted assertions
// (`decryptionPvk`; each key is tried, for rotation) and signs AuthnRequests and logout messages
// (`privateKey`, redirect binding: SigAlg + Signature over the query). The SP metadata is built
// here (not by node-saml, which publishes one encryption key and one logout binding).
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
  /** Its SingleLogoutService (HTTP-Redirect), if it has one. */
  sloUrl?: string | null;
}

/** What the service provider brings to one exchange (#13). */
export interface SpKeyUse {
  /** PEM private key that signs AuthnRequests and logout messages; absent: unsigned. */
  signingKey?: string | null;
  /** PEM private key that decrypts encrypted assertions (and encrypted NameIDs). */
  decryptionKey?: string | null;
  /** Our single logout endpoint (where the IdP sends logout messages). */
  sloUrl?: string;
}

export function samlFor(workspaceId: string, sp: SpUrls, idp: IdpSettings, keys: SpKeyUse = {}): SAML {
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
    // Unsolicited responses are told apart (profile.inResponseTo null) and gated in signIn.ts.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    requestIdExpirationPeriodMs: SAML_REQUEST_TTL_MS,
    rejectReplayedAssertions: true,
    cacheProvider: cacheFor(workspaceId),
    acceptedClockSkewMs: CLOCK_SKEW_MS,
    maxAssertionAgeMs: MAX_ASSERTION_AGE_MS,
    identifierFormat: null, // let the IdP choose (email or persistent); the subject is NameID either way
    disableRequestedAuthnContext: true, // accept MFA / passwordless / Kerberos as the IdP decides
    signatureAlgorithm: 'sha256',
    ...(keys.signingKey ? { privateKey: keys.signingKey } : {}),
    ...(keys.decryptionKey ? { decryptionPvk: keys.decryptionKey } : {}),
    // Logout messages go to the IdP's single logout service (never its sign-in URL).
    ...(idp.sloUrl ? { logoutUrl: idp.sloUrl } : {}),
    ...(keys.sloUrl ? { logoutCallbackUrl: keys.sloUrl } : {}),
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
  // Single logout (#13): we send over HTTP-Redirect, so only that binding's endpoint counts.
  const slo = Array.from(idp.getElementsByTagNameNS(MD, 'SingleLogoutService')).find((s) => s.getAttribute('Binding') === REDIRECT_BINDING);
  const sloUrl = slo?.getAttribute('Location')?.trim() || null;
  return { entityId, ssoUrl: checkHttpsUrl(ssoUrl, 'SingleSignOnService'), certs, sloUrl: sloUrl ? checkHttpsUrl(sloUrl, 'SingleLogoutService') : null };
}

const xmlEsc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
const certBody = (pem: string) => pem.replace(/-----[A-Z ]+-----|\s+/g, '');
const POST_BINDING = 'urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST';
const ENCRYPTION_METHODS = [
  'http://www.w3.org/2009/xmlenc11#aes256-gcm',
  'http://www.w3.org/2009/xmlenc11#aes128-gcm',
  'http://www.w3.org/2001/04/xmlenc#aes256-cbc',
  'http://www.w3.org/2001/04/xmlenc#aes128-cbc',
];

/**
 * Our SP metadata: every key pair's certificate for signing AND encryption (both are live during a
 * rotation), the single logout endpoint in both bindings, the ACS. `AuthnRequestsSigned` says
 * whether we sign (the IdP may then insist on it).
 */
export function serviceProviderMetadata(o: { entityId: string; acsUrl: string; sloUrl: string; certificates: string[]; signsRequests: boolean }): string {
  const key = (use: 'signing' | 'encryption', pem: string) =>
    `<md:KeyDescriptor use="${use}"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${certBody(pem)}</ds:X509Certificate></ds:X509Data></ds:KeyInfo>${
      use === 'encryption' ? ENCRYPTION_METHODS.map((a) => `<md:EncryptionMethod Algorithm="${a}"/>`).join('') : ''
    }</md:KeyDescriptor>`;
  return [
    '<?xml version="1.0"?>',
    `<md:EntityDescriptor xmlns:md="${MD}" xmlns:ds="${DS}" entityID="${xmlEsc(o.entityId)}">`,
    `<md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" AuthnRequestsSigned="${o.signsRequests}" WantAssertionsSigned="true">`,
    ...o.certificates.map((c) => key('signing', c)),
    ...o.certificates.map((c) => key('encryption', c)),
    `<md:SingleLogoutService Binding="${REDIRECT_BINDING}" Location="${xmlEsc(o.sloUrl)}"/>`,
    `<md:SingleLogoutService Binding="${POST_BINDING}" Location="${xmlEsc(o.sloUrl)}"/>`,
    `<md:AssertionConsumerService Binding="${POST_BINDING}" Location="${xmlEsc(o.acsUrl)}" index="1" isDefault="true"/>`,
    '</md:SPSSODescriptor>',
    '</md:EntityDescriptor>',
  ].join('\n');
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
  /** The request it answers, as verified by its signature; null: unsolicited (IdP-initiated). */
  inResponseTo: string | null;
  /** The IdP's session (#13, single logout): its NameID format and SessionIndex, when given. */
  nameIdFormat: string | null;
  sessionIndex: string | null;
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
    inResponseTo: typeof profile.inResponseTo === 'string' && profile.inResponseTo ? profile.inResponseTo : null,
    nameIdFormat: typeof profile.nameIDFormat === 'string' && profile.nameIDFormat ? profile.nameIDFormat : null,
    sessionIndex: typeof profile.sessionIndex === 'string' && profile.sessionIndex ? profile.sessionIndex : null,
  };
}

const PROTOCOL = 'urn:oasis:names:tc:SAML:2.0:protocol';

/**
 * The Destination of the posted Response (after the library verified it). Read only to REFUSE an
 * unsolicited response that isn't addressed to this ACS; null when absent or unreadable.
 */
export function responseDestination(samlResponse: string): string | null {
  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  if (/<!DOCTYPE/i.test(xml)) return null;
  const doc = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, 'text/xml');
  const root = doc?.documentElement;
  if (!root || root.localName !== 'Response' || root.namespaceURI !== PROTOCOL) return null;
  return root.getAttribute('Destination')?.trim() || null;
}

export const sameAcs = sameUrl;

const elementChildren = (n: { childNodes: ArrayLike<unknown> }) =>
  Array.from(n.childNodes as ArrayLike<{ nodeType: number; localName: string }>).filter((c) => c.nodeType === 1);

/** The posted Response's top-level assertion as it arrived: 'encrypted', 'plain', or null (none / unreadable). */
export function responseAssertionKind(samlResponse: string): 'encrypted' | 'plain' | null {
  const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
  if (/<!DOCTYPE/i.test(xml)) return null;
  const root = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, 'text/xml')?.documentElement;
  if (!root || root.localName !== 'Response' || root.namespaceURI !== PROTOCOL) return null;
  const kids = elementChildren(root);
  if (kids.some((k) => k.localName === 'Assertion')) return 'plain';
  return kids.some((k) => k.localName === 'EncryptedAssertion') ? 'encrypted' : null;
}

/**
 * The root attributes of a logout message the library VERIFIED (a POST body, or the inflated
 * SAMLRequest / SAMLResponse of a signed redirect): what we check that it doesn't hand back.
 */
export function logoutMessageAttributes(xml: string): { kind: 'LogoutRequest' | 'LogoutResponse'; id: string | null; destination: string | null; issueInstant: number | null } | null {
  if (/<!DOCTYPE/i.test(xml)) return null;
  const root = new DOMParser({ errorHandler: () => {} }).parseFromString(xml, 'text/xml')?.documentElement;
  if (!root || root.namespaceURI !== PROTOCOL || (root.localName !== 'LogoutRequest' && root.localName !== 'LogoutResponse')) return null;
  const instant = root.getAttribute('IssueInstant');
  return {
    kind: root.localName,
    id: root.getAttribute('ID') || null,
    destination: root.getAttribute('Destination')?.trim() || null,
    issueInstant: instant ? Date.parse(instant) || null : null,
  };
}
