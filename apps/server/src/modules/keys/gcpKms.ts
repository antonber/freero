// Google Cloud KMS: the workspace's symmetric CryptoKey wraps its data keys (`:encrypt` /
// `:decrypt`, REST v1) with additionalAuthenticatedData "freero_workspace=<id>", which KMS binds
// into the ciphertext. The operator's service account (KMS_GCP_CREDENTIALS) calls it with an
// OAuth access token it gets for a JWT it signs itself (RS256, the JWT-bearer grant); customers
// grant that account roles/cloudkms.cryptoKeyEncrypterDecrypter on their key, and revoking the
// grant, or disabling / destroying the key version, is how they revoke access.
import { createSign } from 'node:crypto';
import { getConfig } from '../../platform/config';
import type { KmsProvider } from './kek';
import { cachedToken, forgetToken, judge, KeyRefusedError, kmsFetch, KmsUnreachableError } from './kmsHttp';

const SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const NAME_RE = /^projects\/[a-z0-9.:-]{4,100}\/locations\/[a-z0-9-]{1,63}\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/;

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

/** A JWT for the JWT-bearer grant (RFC 7523), signed with the service account's private key. */
export function serviceAccountAssertion(c: { clientEmail: string; privateKey: string; tokenUri: string }, now: number): string {
  const iat = Math.floor(now / 1000);
  const head = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: c.clientEmail, scope: SCOPE, aud: c.tokenUri, iat, exp: iat + 3600 }));
  const signature = createSign('RSA-SHA256').update(`${head}.${claims}`).sign(c.privateKey);
  return `${head}.${claims}.${b64url(signature)}`;
}

function creds() {
  const c = getConfig().workspaceKeys.gcpKms;
  if (!c) throw new KeyRefusedError('this server has no Google Cloud KMS credentials (KMS_GCP_CREDENTIALS)');
  return c;
}

const tokenKey = () => `gcp:${creds().clientEmail}`;

function accessToken(): Promise<string> {
  const c = creds();
  return cachedToken(tokenKey(), async () => {
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: serviceAccountAssertion(c, Date.now()) }).toString();
    const a = await kmsFetch(c.tokenUri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (a.status !== 200 || typeof a.json.access_token !== 'string') judge(a, 'Google sign-in for Cloud KMS', String(a.json.error_description ?? a.json.error ?? ''));
    return { token: a.json.access_token as string, expiresInSeconds: Number(a.json.expires_in ?? 3600) };
  });
}

async function call(name: string, verb: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, unknown>> {
  if (!NAME_RE.test(name)) throw new KeyRefusedError('not a Google Cloud KMS key name');
  const url = `${creds().endpoint.replace(/\/+$/, '')}/v1/${name}:${verb}`;
  const a = await kmsFetch(url, { method: 'POST', headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (a.status === 200) return a.json;
  const err = (a.json.error ?? {}) as { status?: unknown; message?: unknown };
  const detail = `${String(err.status ?? '')} ${String(err.message ?? '')}`.trim();
  // An access token it no longer takes (expired early, rotated): a new one next time, not a refusal of the key.
  if (a.status === 401) {
    forgetToken(tokenKey());
    throw new KmsUnreachableError(`Cloud KMS did not accept the access token: ${detail}`.slice(0, 300));
  }
  return judge(a, 'Cloud KMS', detail);
}

const aad = (workspaceId: string) => Buffer.from(`freero_workspace=${workspaceId}`, 'utf8').toString('base64');

export const gcpKms: KmsProvider = {
  id: 'gcp-kms',
  name: 'Google Cloud KMS',
  configured: () => getConfig().workspaceKeys.gcpKms !== null,
  parseKeyId: (s) => (NAME_RE.test(s) ? s : null),
  async wrap(name, workspaceId, dek) {
    const out = await call(name, 'encrypt', { plaintext: dek.toString('base64'), additionalAuthenticatedData: aad(workspaceId) });
    if (typeof out.ciphertext !== 'string') throw new KmsUnreachableError('Cloud KMS answered encrypt without a ciphertext');
    return out.ciphertext;
  },
  async unwrap(name, workspaceId, wrapped) {
    const out = await call(name, 'decrypt', { ciphertext: wrapped, additionalAuthenticatedData: aad(workspaceId) });
    if (typeof out.plaintext !== 'string') throw new KmsUnreachableError('Cloud KMS answered decrypt without a plaintext');
    return Buffer.from(out.plaintext, 'base64');
  },
};
