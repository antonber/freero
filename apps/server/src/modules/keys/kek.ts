// Key-encryption keys: what wraps a workspace's data keys. Two providers:
// - 'instance': platform/secrets `seal` under its own purpose (HKDF of SESSION_SECRET), the
//   workspace id sealed in with the key so a wrapped key copied to another workspace never opens.
//   Rotating SESSION_SECRET rotates it: an unwrap under a previous secret says `stale`, and the
//   caller wraps again.
// - 'aws-kms': the workspace's own AWS KMS key. Encrypt / Decrypt (TrentService JSON API, SigV4)
//   with the encryption context { freero_workspace: <id> }, which KMS binds into the ciphertext and
//   logs in CloudTrail. The operator's principal (KMS_AWS_*) calls KMS; the customer's key policy
//   grants it, and revoking that grant (or disabling the key) is how the customer revokes access.
import { getConfig } from '../../platform/config';
import { seal, unseal } from '../../platform/secrets';
import { signRequest } from './sigv4';

const INSTANCE_PURPOSE = 'workspace-kek-v1';
const KMS_TIMEOUT_MS = 5000;

/** The KMS (or the instance) answered: this key can't be used (disabled, deleted, access revoked, not ours). */
export class KeyRefusedError extends Error {}
/** The KMS couldn't be asked (network, timeout, throttling, 5xx): try again later. */
export class KmsUnreachableError extends Error {}

export interface KekRef {
  provider: 'instance' | 'aws-kms';
  /** The KMS key ARN for 'aws-kms'. */
  kmsKeyId: string | null;
}

/** What the stored data key names as the key that wrapped it. */
export const kekRefOf = (k: KekRef): string => (k.provider === 'instance' ? 'instance' : k.kmsKeyId!);

export async function wrapDataKey(k: KekRef, workspaceId: string, dek: Buffer): Promise<string> {
  if (k.provider === 'instance') return seal(INSTANCE_PURPOSE, `${workspaceId}.${dek.toString('base64url')}`);
  const out = await kms('Encrypt', k.kmsKeyId!, { KeyId: k.kmsKeyId, Plaintext: dek.toString('base64'), EncryptionContext: { freero_workspace: workspaceId } });
  if (typeof out.CiphertextBlob !== 'string') throw new KmsUnreachableError('KMS answered Encrypt without a ciphertext');
  return out.CiphertextBlob;
}

/** The data key, and whether it should be wrapped again (made under a previous instance secret). */
export async function unwrapDataKey(k: KekRef, workspaceId: string, wrapped: string): Promise<{ dek: Buffer; stale: boolean }> {
  if (k.provider === 'instance') {
    const opened = unseal(INSTANCE_PURPOSE, wrapped);
    if (!opened) throw new KeyRefusedError('no configured instance secret opens this data key');
    const dot = opened.value.indexOf('.');
    if (opened.value.slice(0, dot) !== workspaceId) throw new KeyRefusedError('this data key belongs to another workspace');
    return { dek: Buffer.from(opened.value.slice(dot + 1), 'base64url'), stale: opened.stale };
  }
  const out = await kms('Decrypt', k.kmsKeyId!, { CiphertextBlob: wrapped, KeyId: k.kmsKeyId, EncryptionContext: { freero_workspace: workspaceId } });
  if (typeof out.Plaintext !== 'string') throw new KmsUnreachableError('KMS answered Decrypt without a plaintext');
  const dek = Buffer.from(out.Plaintext, 'base64');
  if (dek.length !== 32) throw new KeyRefusedError('KMS returned a key of the wrong size');
  return { dek, stale: false };
}

/** arn:aws:kms:<region>:<account>:key/<id> (or alias/<name>) → its region; null if it isn't one. */
export function kmsRegionOf(arn: string): string | null {
  const m = /^arn:aws[a-z-]*:kms:([a-z0-9-]+):\d{12}:(key|alias)\/[A-Za-z0-9/_+=.@-]{1,256}$/.exec(arn);
  return m ? m[1] : null;
}

/** KMS error types that mean "this key may not be used", as opposed to "ask again later". */
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

async function kms(action: 'Encrypt' | 'Decrypt', arn: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
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
  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(KMS_TIMEOUT_MS), redirect: 'error' });
  } catch (e) {
    throw new KmsUnreachableError(`KMS could not be reached: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    // not JSON: judged by the status below
  }
  if (res.ok) return json;
  const type = String(json.__type ?? '').split('#').pop() ?? '';
  const message = String(json.message ?? json.Message ?? `HTTP ${res.status}`).slice(0, 300);
  if (REFUSED.has(type) || res.status === 403) throw new KeyRefusedError(`${type || 'refused'}: ${message}`);
  throw new KmsUnreachableError(`${type || `HTTP ${res.status}`}: ${message}`);
}
