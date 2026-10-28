// Test-only: an RSA key pair and a self-signed X.509 v3 certificate (sha256WithRSAEncryption),
// DER-encoded by hand so tests need no OpenSSL or extra package. Used by the local SAML identity
// provider (scripts/lib/mock-saml.mjs), whose metadata publishes the certificate.
import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';

const len = (n) => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const int = (buf) => tlv(0x02, buf[0] & 0x80 ? Buffer.concat([Buffer.from([0]), buf]) : buf);
const oid = (dotted) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const utcTime = (d) => tlv(0x17, Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'));
const name = (cn) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)));

/** { privateKeyPem, certPem, certBase64 } for `cn`, valid from yesterday for `days`. */
export function selfSignedCertificate(cn = 'Freero test IdP', days = 365) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.now();
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), // v3
    int(randomBytes(12)),
    SHA256_RSA,
    name(cn),
    seq(utcTime(new Date(now - 86_400_000)), utcTime(new Date(now + days * 86_400_000))),
    name(cn),
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const signature = sign('sha256', tbs, privateKey);
  const der = seq(tbs, SHA256_RSA, tlv(0x03, Buffer.concat([Buffer.from([0]), signature])));
  const certBase64 = der.toString('base64');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    certPem: `-----BEGIN CERTIFICATE-----\n${certBase64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    certBase64,
  };
}
