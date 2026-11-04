// Test-only SAML 2.0 identity provider: metadata with a real (self-signed) signing certificate, an
// SSO endpoint for the HTTP-Redirect binding that answers with an auto-posting form (HTTP-POST
// binding) carrying a response whose assertion is signed with xml-crypto (RSA-SHA256, exclusive
// c14n) — the way Okta and Entra ID answer. `buildResponse` also makes the broken ones the checks
// need (unsigned, wrong audience, expired, another key, …), assertions encrypted to the service
// provider's certificate (XML Encryption: AES-256-GCM, RSA-OAEP key transport), and single logout
// messages (LogoutRequest over HTTP-Redirect or HTTP-POST, signed or not; a SingleLogoutService
// that answers the SP's LogoutRequest with a signed LogoutResponse). `npm run verify` uses it so the
// server's real SAML stack (node-saml) validates real signatures; it also runs standalone:
//
//   node scripts/lib/mock-saml.mjs --port 4312
//
// Never use it outside tests: it signs in whoever types an address.
import { constants, createCipheriv, publicEncrypt, randomBytes, sign as rsaSign } from 'node:crypto';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { DOMParser } from '@xmldom/xmldom';
import { SignedXml } from 'xml-crypto';
import { selfSignedCertificate } from './test-cert.mjs';

const inflateRaw = promisify(zlib.inflateRaw);
const deflateRaw = promisify(zlib.deflateRaw);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const iso = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
const newId = () => `_${randomBytes(16).toString('hex')}`;

const RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

/** Signs the element matched by `xpath` (an Assertion or the Response), signature right after its Issuer. */
export function signXml(xml, xpath, key) {
  const sig = new SignedXml({ privateKey: key.privateKeyPem, publicCert: key.certPem, signatureAlgorithm: RSA_SHA256, canonicalizationAlgorithm: EXC_C14N });
  sig.addReference({ xpath, digestAlgorithm: SHA256, transforms: [ENVELOPED, EXC_C14N] });
  sig.computeSignature(xml, { location: { reference: `${xpath}/*[local-name(.)='Issuer']`, action: 'after' } });
  return sig.getSignedXml();
}

/**
 * `<saml:EncryptedAssertion>` around `assertionXml` (already signed), for the holder of `certPem`'s
 * key: AES-256-GCM content key, wrapped with RSA-OAEP (SHA-1 MGF1, rsa-oaep-mgf1p) — what Entra
 * ID and Okta send.
 */
export function encryptAssertion(assertionXml, certPem) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([iv, cipher.update(assertionXml.replace(/^<\?xml[^>]*>/, ''), 'utf8'), cipher.final(), cipher.getAuthTag()]);
  const wrapped = publicEncrypt({ key: certPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, key);
  return `<saml:EncryptedAssertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion"><xenc:EncryptedData xmlns:xenc="http://www.w3.org/2001/04/xmlenc#" Type="http://www.w3.org/2001/04/xmlenc#Element"><xenc:EncryptionMethod Algorithm="http://www.w3.org/2009/xmlenc11#aes256-gcm"/><ds:KeyInfo xmlns:ds="http://www.w3.org/2000/09/xmldsig#"><xenc:EncryptedKey><xenc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#rsa-oaep-mgf1p"/><xenc:CipherData><xenc:CipherValue>${wrapped.toString('base64')}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedKey></ds:KeyInfo><xenc:CipherData><xenc:CipherValue>${data.toString('base64')}</xenc:CipherValue></xenc:CipherData></xenc:EncryptedData></saml:EncryptedAssertion>`;
}

/** The HTTP-Redirect binding's query for a SAML message: `param`, RelayState, SigAlg + Signature when `key` signs. */
export async function redirectQuery(param, xml, { relayState = '', key = null } = {}) {
  const params = new URLSearchParams();
  params.set(param, (await deflateRaw(Buffer.from(xml, 'utf8'))).toString('base64'));
  if (relayState) params.set('RelayState', relayState);
  if (!key) return params.toString();
  params.set('SigAlg', RSA_SHA256);
  const signature = rsaSign('sha256', Buffer.from(params.toString(), 'utf8'), key.privateKeyPem).toString('base64');
  return `${params.toString()}&Signature=${encodeURIComponent(signature)}`;
}

export async function startMockSaml({ port = 0, host = '127.0.0.1' } = {}) {
  const key = selfSignedCertificate('Freero test SAML IdP');
  const queued = [];
  /** LogoutRequests the SP sent (SP-initiated logouts), oldest first. */
  const loggedOut = [];
  let base = '';
  const entityId = () => `${base}/metadata`;

  /**
   * A base64 SAMLResponse. `sign`: 'assertion' (default), 'response', 'both' or 'none'. Every field
   * can be overridden to make a response the SP must refuse.
   */
  function buildResponse(o) {
    const now = o.now ?? Date.now();
    const issuer = o.issuer ?? entityId();
    const nameId = o.nameId ?? o.email;
    const assertionId = o.assertionId ?? newId();
    const attrs = { email: o.email, ...(o.name ? { displayName: o.name } : {}), ...(o.attributes ?? {}) };
    const assertion = `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${assertionId}" Version="2.0" IssueInstant="${iso(o.issueInstant ?? now)}">
<saml:Issuer>${esc(issuer)}</saml:Issuer>
<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${esc(nameId)}</saml:NameID>
<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData${o.inResponseTo ? ` InResponseTo="${esc(o.inResponseTo)}"` : ''} NotOnOrAfter="${iso(o.notOnOrAfter ?? now + 5 * 60_000)}" Recipient="${esc(o.recipient ?? o.acsUrl)}"/></saml:SubjectConfirmation></saml:Subject>
<saml:Conditions NotBefore="${iso(o.notBefore ?? now - 60_000)}" NotOnOrAfter="${iso(o.notOnOrAfter ?? now + 5 * 60_000)}"><saml:AudienceRestriction><saml:Audience>${esc(o.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>
<saml:AuthnStatement AuthnInstant="${iso(now)}" SessionIndex="${esc(o.sessionIndex ?? newId())}"${o.sessionNotOnOrAfter ? ` SessionNotOnOrAfter="${iso(o.sessionNotOnOrAfter)}"` : ''}><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>
<saml:AttributeStatement>${Object.entries(attrs)
      .map(([k, v]) => `<saml:Attribute Name="${esc(k)}"><saml:AttributeValue>${esc(v)}</saml:AttributeValue></saml:Attribute>`)
      .join('')}</saml:AttributeStatement>
</saml:Assertion>`;
    const sign = o.sign ?? 'assertion';
    const signingKey = o.key ?? key;
    const signed = sign === 'assertion' || sign === 'both' ? signXml(assertion, "//*[local-name(.)='Assertion']", signingKey) : assertion;
    // `encryptTo`: the SP's certificate (PEM) — the assertion travels encrypted to its key.
    const signedAssertion = o.encryptTo ? encryptAssertion(signed, o.encryptTo) : signed;
    let response = `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${newId()}" Version="2.0" IssueInstant="${iso(now)}" Destination="${esc(o.acsUrl)}"${o.inResponseTo ? ` InResponseTo="${esc(o.inResponseTo)}"` : ''}>
<saml:Issuer>${esc(issuer)}</saml:Issuer>
<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
${signedAssertion.replace(/^<\?xml[^>]*>/, '')}
</samlp:Response>`;
    if (sign === 'response' || sign === 'both') response = signXml(response, "/*[local-name(.)='Response']", signingKey);
    return Buffer.from(response).toString('base64');
  }

  /**
   * A LogoutRequest from this IdP: { query } for HTTP-Redirect (signed unless `sign: false`) or
   * { body } (base64) for HTTP-POST (signed enveloped unless `sign: false`). Fields can be
   * overridden to make one the SP must refuse (another key, issuer, Destination, an old instant).
   */
  async function buildLogoutRequest(o) {
    const now = o.issueInstant ?? Date.now();
    const id = o.id ?? newId();
    const xml = `<samlp:LogoutRequest xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(now)}" Destination="${esc(o.destination)}">
<saml:Issuer>${esc(o.issuer ?? entityId())}</saml:Issuer>
<saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${esc(o.nameId)}</saml:NameID>${o.sessionIndex ? `\n<samlp:SessionIndex>${esc(o.sessionIndex)}</samlp:SessionIndex>` : ''}
</samlp:LogoutRequest>`;
    const signingKey = o.sign === false ? null : (o.key ?? key);
    if (o.binding === 'post') return { id, body: Buffer.from(signingKey ? signXml(xml, "/*[local-name(.)='LogoutRequest']", signingKey) : xml).toString('base64') };
    return { id, query: await redirectQuery('SAMLRequest', xml, { relayState: o.relayState ?? '', key: signingKey }) };
  }

  /** The LogoutRequest a redirect carried (an SP-initiated logout): { id, nameId, sessionIndex, issuer, query }. */
  async function readLogoutRequest(url) {
    const xml = (await inflateRaw(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'))).toString('utf8');
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const text = (ns, name) => el.getElementsByTagNameNS(ns, name)[0]?.textContent ?? null;
    return {
      id: el.getAttribute('ID'),
      destination: el.getAttribute('Destination'),
      issuer: text('urn:oasis:names:tc:SAML:2.0:assertion', 'Issuer'),
      nameId: text('urn:oasis:names:tc:SAML:2.0:assertion', 'NameID'),
      sessionIndex: text('urn:oasis:names:tc:SAML:2.0:protocol', 'SessionIndex'),
    };
  }

  /** A signed LogoutResponse (HTTP-Redirect query) answering `inResponseTo`, for the SP's `destination`. */
  function buildLogoutResponse({ inResponseTo, destination, sign = true }) {
    const xml = `<samlp:LogoutResponse xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${newId()}" Version="2.0" IssueInstant="${iso(Date.now())}" Destination="${esc(destination)}" InResponseTo="${esc(inResponseTo)}">
<saml:Issuer>${esc(entityId())}</saml:Issuer>
<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>
</samlp:LogoutResponse>`;
    return redirectQuery('SAMLResponse', xml, { key: sign ? key : null });
  }

  /** The AuthnRequest a redirect carried: { id, acsUrl, issuer }. */
  async function readRequest(url) {
    const xml = (await inflateRaw(Buffer.from(url.searchParams.get('SAMLRequest') ?? '', 'base64'))).toString('utf8');
    const el = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
    const issuer = el.getElementsByTagNameNS('urn:oasis:names:tc:SAML:2.0:assertion', 'Issuer')[0]?.textContent ?? '';
    return { id: el.getAttribute('ID'), acsUrl: el.getAttribute('AssertionConsumerServiceURL'), issuer };
  }

  const postForm = (res, acsUrl, samlResponse, relayState) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta charset="utf-8"><title>Signing you in…</title><body onload="document.forms[0].submit()">
<form method="post" action="${esc(acsUrl)}"><input type="hidden" name="SAMLResponse" value="${esc(samlResponse)}"><input type="hidden" name="RelayState" value="${esc(relayState ?? '')}"><noscript><button type="submit">Continue</button></noscript></form>`);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let s = '';
      req.on('data', (d) => (s += d));
      req.on('end', () => resolve(s));
      req.on('error', reject);
    });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, base);
      if (req.method === 'GET' && url.pathname === '/metadata') {
        res.writeHead(200, { 'content-type': 'application/samlmetadata+xml' });
        return res.end(metadataXml());
      }
      if (req.method === 'GET' && url.pathname === '/slo' && url.searchParams.has('SAMLRequest')) {
        // The SP's sign-out: "sign out" here too, and answer with a signed LogoutResponse.
        const r = await readLogoutRequest(url);
        loggedOut.push(r);
        const sp = new URL(r.issuer ?? '');
        const answer = await buildLogoutResponse({ inResponseTo: r.id, destination: `${sp.origin}${sp.pathname.replace(/\/metadata$/, '/slo')}` });
        res.writeHead(302, { location: `${sp.origin}${sp.pathname.replace(/\/metadata$/, '/slo')}?${answer}` });
        return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/sso') {
        const r = await readRequest(url);
        const relay = url.searchParams.get('RelayState');
        const user = queued.shift();
        if (user) return postForm(res, r.acsUrl, buildResponse({ ...user, inResponseTo: r.id, acsUrl: r.acsUrl, audience: r.issuer }), relay);
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(`<!doctype html><meta charset="utf-8"><title>Test SAML identity provider</title>
<style>body{font:15px system-ui;max-width:360px;margin:60px auto;color:#222}label{display:block;margin:12px 0 4px}input{width:100%;padding:8px;box-sizing:border-box}button{margin-top:16px;padding:8px 14px}</style>
<h1>Test SAML identity provider</h1><p>Local testing only. Sign in as:</p>
<form method="post" action="/sso"><input type="hidden" name="id" value="${esc(r.id)}"><input type="hidden" name="acs" value="${esc(r.acsUrl)}"><input type="hidden" name="sp" value="${esc(r.issuer)}"><input type="hidden" name="relay" value="${esc(relay ?? '')}">
<label>Email<input type="email" name="email" value="${esc(url.searchParams.get('login_hint') ?? '')}" required></label>
<label>Name<input type="text" name="name"></label>
<button type="submit">Sign in</button></form>`);
      }
      if (req.method === 'POST' && url.pathname === '/sso') {
        const p = Object.fromEntries(new URLSearchParams(await readBody(req)));
        return postForm(res, p.acs, buildResponse({ email: p.email, name: p.name || undefined, inResponseTo: p.id, acsUrl: p.acs, audience: p.sp }), p.relay);
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(500, { 'content-type': 'text/plain' }).end(String(e?.stack ?? e));
    }
  });

  const metadataXml = () => `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" xmlns:ds="http://www.w3.org/2000/09/xmldsig#" entityID="${esc(entityId())}">
<md:IDPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol" WantAuthnRequestsSigned="false">
<md:KeyDescriptor use="signing"><ds:KeyInfo><ds:X509Data><ds:X509Certificate>${key.certBase64}</ds:X509Certificate></ds:X509Data></ds:KeyInfo></md:KeyDescriptor>
<md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${esc(base)}/sso"/>
<md:SingleSignOnService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${esc(base)}/sso"/>
<md:SingleLogoutService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect" Location="${esc(base)}/slo"/>
</md:IDPSSODescriptor></md:EntityDescriptor>`;

  await new Promise((resolve) => server.listen(port, host, resolve));
  base = `http://${host}:${server.address().port}`;
  return {
    get entityId() {
      return entityId();
    },
    ssoUrl: `${base}/sso`,
    metadataXml,
    certPem: key.certPem,
    sloUrl: `${base}/slo`,
    readRequest,
    buildResponse,
    buildLogoutRequest,
    readLogoutRequest,
    buildLogoutResponse,
    loggedOut,
    /** The next sign-in request is answered at once for `user` = { email, name?, nameId?, sessionNotOnOrAfter?, attributes? }. */
    queueSignIn: (user) => queued.push(user),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const idp = await startMockSaml({ port: i > 0 ? Number(process.argv[i + 1]) : 4312 });
  console.log(`mock SAML IdP: metadata ${idp.entityId}`);
}
