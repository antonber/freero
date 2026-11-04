// The SAML service provider's own key pairs (#13): what IdPs encrypt assertions to and verify our
// signed AuthnRequests and logout messages with. Per workspace, at most two: the CURRENT one signs,
// and both decrypt — so a rotation is "add the next key, give the IdP its certificate, make it
// current, remove the old one" without a moment where either side can't read the other.
//
// RSA-2048 from node:crypto. Node can't make X.509 certificates, and IdPs want one (metadata
// carries certificates, not bare keys), so the minimal self-signed v3 certificate is DER-encoded
// here and signed with crypto.sign (sha256WithRSAEncryption); X509Certificate parses it back as a
// check. Nothing trusts it as a CA: the IdP pins exactly this certificate.
// The private key is sealed at rest ('sso-sp-key-v1') and is never returned by any API.
import { generateKeyPairSync, randomBytes, sign, X509Certificate } from 'node:crypto';
import type { SsoSpKey } from '@freero/shared';
import { HttpError } from '../../platform/http';
import { newId } from '../../platform/ids';
import { seal, unseal } from '../../platform/secrets';
import { recordAudit } from '../audit/index';
import * as repo from './repo';
import { certificateInfo } from './saml';

/** The HKDF purpose sealing SP private keys at rest (platform/secrets). */
export const SP_KEY_PURPOSE = 'sso-sp-key-v1';
/** The current key and the next one (rotation). */
const MAX_KEYS = 2;
const VALID_DAYS = 10 * 365;

// ---- DER, just enough for one certificate ----
const len = (n: number): Buffer => {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
};
const tlv = (tag: number, body: Buffer) => Buffer.concat([Buffer.from([tag]), len(body.length), body]);
const seq = (...items: Buffer[]) => tlv(0x30, Buffer.concat(items));
const set = (...items: Buffer[]) => tlv(0x31, Buffer.concat(items));
const int = (b: Buffer) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);
const oid = (dotted: string) => {
  const [a, b, ...rest] = dotted.split('.').map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const chunk = [n & 0x7f];
    for (let v = n >> 7; v > 0; v >>= 7) chunk.unshift(0x80 | (v & 0x7f));
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
};
const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
/** UTCTime until 2049, GeneralizedTime after (RFC 5280 4.1.2.5). */
const time = (d: Date) => {
  const s = d.toISOString().replace(/[-:T]/g, '').slice(0, 14) + 'Z';
  return d.getUTCFullYear() < 2050 ? tlv(0x17, Buffer.from(s.slice(2))) : tlv(0x18, Buffer.from(s));
};
const name = (cn: string) => seq(set(seq(oid('2.5.4.3'), utf8(cn))));
const SHA256_RSA = seq(oid('1.2.840.113549.1.1.11'), tlv(0x05, Buffer.alloc(0)));

/** A new RSA-2048 key pair with a self-signed certificate for `commonName`. */
export function newKeyPair(commonName: string, now = Date.now()): { privateKeyPem: string; certificatePem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const serial = randomBytes(16);
  serial[0] &= 0x7f; // positive
  const tbs = seq(
    tlv(0xa0, int(Buffer.from([2]))), // v3
    int(serial),
    SHA256_RSA,
    name(commonName),
    seq(time(new Date(now - 86_400_000)), time(new Date(now + VALID_DAYS * 86_400_000))),
    name(commonName),
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const der = seq(tbs, SHA256_RSA, tlv(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])));
  const certificatePem = `-----BEGIN CERTIFICATE-----\n${der.toString('base64').match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----`;
  const parsed = new X509Certificate(certificatePem);
  if (!parsed.verify(publicKey)) throw new Error('sso: the new SP certificate does not verify');
  return { privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string, certificatePem };
}

/** The key pairs as the admin console sees them: certificates only. */
export async function spKeysOf(workspaceId: string): Promise<SsoSpKey[]> {
  return (await repo.listSpKeys(workspaceId)).map((k) => ({ id: k.id, current: k.current, createdAt: k.createdAt, certificate: k.certificate, ...certificateInfo(k.certificate) }));
}

export interface UsableKey {
  id: string;
  current: boolean;
  privateKeyPem: string;
  certificatePem: string;
}

/**
 * The workspace's key pairs with their private keys opened, the current one first. A key no
 * configured secret opens (SESSION_SECRET replaced without keeping the old one) is left out; one
 * made under a previous secret is sealed again.
 */
export async function usableKeys(workspaceId: string): Promise<UsableKey[]> {
  const out: UsableKey[] = [];
  for (const k of await repo.listSpKeys(workspaceId)) {
    const opened = unseal(SP_KEY_PURPOSE, k.privateKey);
    if (!opened) continue;
    if (opened.stale) void repo.resealSpKey(k.id, k.privateKey, seal(SP_KEY_PURPOSE, opened.value)).catch(() => {});
    out.push({ id: k.id, current: k.current, privateKeyPem: opened.value, certificatePem: k.certificate });
  }
  return out.sort((a, b) => Number(b.current) - Number(a.current));
}

/** A new key pair: the first becomes current; a second waits as the next one until promoted. */
export async function createSpKey(workspaceId: string, actorId: string): Promise<void> {
  const { privateKeyPem, certificatePem } = newKeyPair(`Freero SAML service provider ${workspaceId}`);
  const id = newId(16);
  await repo.transaction(async () => {
    const existing = await repo.lockSpKeys(workspaceId);
    if (existing.length >= MAX_KEYS) throw new HttpError(409, 'There are already two keys: remove the one you no longer use first');
    const current = existing.length === 0;
    await repo.insertSpKey({ id, workspaceId, privateKey: seal(SP_KEY_PURPOSE, privateKeyPem), certificate: certificatePem, current }, Date.now());
    await recordAudit({
      action: 'sso.sp_key_created',
      workspaceId,
      actorId,
      target: { type: 'sso', id: workspaceId, label: certificateInfo(certificatePem).fingerprint },
      metadata: { keyId: id, current },
    });
  });
}

/** Makes a key the one that signs; the other keeps decrypting until it is removed. */
export async function promoteSpKey(workspaceId: string, keyId: string, actorId: string): Promise<void> {
  await repo.transaction(async () => {
    const keys = await repo.lockSpKeys(workspaceId);
    const key = keys.find((k) => k.id === keyId);
    if (!key) throw new HttpError(404, 'No such key');
    if (key.current) return;
    await repo.makeSpKeyCurrent(workspaceId, keyId);
    await recordAudit({ action: 'sso.sp_key_rotated', workspaceId, actorId, target: { type: 'sso', id: workspaceId, label: certificateInfo(key.certificate).fingerprint }, metadata: { keyId } });
  });
}

/**
 * Removes a key pair. The current one only when nothing needs it (signed requests, required
 * encryption): otherwise sign-ins would break the moment it is gone.
 */
export async function removeSpKey(workspaceId: string, keyId: string, actorId: string): Promise<void> {
  await repo.transaction(async () => {
    const keys = await repo.lockSpKeys(workspaceId);
    const key = keys.find((k) => k.id === keyId);
    if (!key) throw new HttpError(404, 'No such key');
    if (key.current) {
      if (keys.length > 1) throw new HttpError(409, 'Make the other key current first, then remove this one');
      const c = await repo.getConnection(workspaceId);
      if (c && (c.signRequests || c.requireEncrypted))
        throw new HttpError(409, 'This key signs requests or decrypts the required encrypted assertions: turn those off first');
    }
    await repo.deleteSpKey(workspaceId, keyId);
    await recordAudit({ action: 'sso.sp_key_removed', workspaceId, actorId, target: { type: 'sso', id: workspaceId, label: certificateInfo(key.certificate).fingerprint }, metadata: { keyId } });
  });
}
