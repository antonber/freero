// AWS KMS: Encrypt / Decrypt (TrentService JSON API, SigV4 in sigv4.ts) with the encryption
// context { freero_workspace: <id> }, which KMS binds into the ciphertext and logs in CloudTrail.
// The operator's principal (KMS_AWS_*) calls KMS; the customer's key policy grants it, and revoking
// that grant (or disabling the key) is how the customer revokes access.
import { getConfig } from '../../platform/config';
import type { KmsProvider } from './kek';
import { KeyRefusedError, kmsFetch, KmsUnreachableError } from './kmsHttp';
import { signRequest } from './sigv4';

/** arn:aws:kms:<region>:<account>:key/<id> (or alias/<name>) → its region; null if it isn't one. */
export function kmsRegionOf(arn: string): string | null {
  const m = /^arn:aws[a-z-]*:kms:([a-z0-9-]+):\d{12}:(key|alias)\/[A-Za-z0-9/_+=.@-]{1,256}$/.exec(arn);
  return m ? m[1] : null;
}

/** KMS error types that mean "this key may not be used", as opposed to "ask again later" (throttling is a 400 too). */
const REFUSED = new Set([
  'AccessDeniedException',
  'DisabledException',
  'NotFoundException',
  'KMSInvalidStateException',
  'InvalidCiphertextException',
  'IncorrectKeyException',
  'InvalidKeyUsageException',
  'KeyUnavailableException',
  'UnrecognizedClientException',
  'InvalidSignatureException',
]);

async function call(action: 'Encrypt' | 'Decrypt', arn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const creds = getConfig().workspaceKeys.awsKms;
  if (!creds) throw new KeyRefusedError('this server has no AWS KMS credentials (KMS_AWS_ACCESS_KEY_ID)');
  const region = kmsRegionOf(arn);
  if (!region) throw new KeyRefusedError('not an AWS KMS key ARN');
  const url = new URL(creds.endpoint ?? `https://kms.${region}.amazonaws.com/`);
  const payload = JSON.stringify(body);
  const headers = signRequest({
    method: 'POST',
    url,
    headers: { host: url.host, 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': `TrentService.${action}` },
    body: payload,
    region,
    service: 'kms',
    credentials: creds,
    now: new Date(),
  });
  delete headers.host; // fetch sets it (and refuses to be told)
  const { status, json } = await kmsFetch(url, { method: 'POST', headers, body: payload });
  if (status >= 200 && status < 300) return json;
  const type = String(json.__type ?? '').split('#').pop() ?? '';
  const message = String(json.message ?? json.Message ?? `HTTP ${status}`).slice(0, 300);
  if (REFUSED.has(type) || status === 403) throw new KeyRefusedError(`${type || 'refused'}: ${message}`);
  throw new KmsUnreachableError(`${type || `HTTP ${status}`}: ${message}`);
}

export const awsKms: KmsProvider = {
  id: 'aws-kms',
  name: 'AWS KMS',
  configured: () => getConfig().workspaceKeys.awsKms !== null,
  parseKeyId: (s) => (kmsRegionOf(s) ? s : null),
  async wrap(arn, workspaceId, dek) {
    const out = await call('Encrypt', arn, { KeyId: arn, Plaintext: dek.toString('base64'), EncryptionContext: { freero_workspace: workspaceId } });
    if (typeof out.CiphertextBlob !== 'string') throw new KmsUnreachableError('KMS answered Encrypt without a ciphertext');
    return out.CiphertextBlob;
  },
  async unwrap(arn, workspaceId, wrapped) {
    const out = await call('Decrypt', arn, { CiphertextBlob: wrapped, KeyId: arn, EncryptionContext: { freero_workspace: workspaceId } });
    if (typeof out.Plaintext !== 'string') throw new KmsUnreachableError('KMS answered Decrypt without a plaintext');
    return Buffer.from(out.Plaintext, 'base64');
  },
};
