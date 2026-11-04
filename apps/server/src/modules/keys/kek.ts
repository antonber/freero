// Key-encryption keys: what wraps a workspace's data keys. The providers:
// - 'instance': platform/secrets `seal` under its own purpose (HKDF of SESSION_SECRET), the
//   workspace id sealed in with the key so a wrapped key copied to another workspace never opens.
//   Rotating SESSION_SECRET rotates it: an unwrap under a previous secret says `stale`, and the
//   caller wraps again.
// - the workspace's own key at an external key service, each behind `KmsProvider` (awsKms.ts,
//   gcpKms.ts, azureKeyVault.ts, vaultTransit.ts): the operator's credentials call it, the
//   customer grants them use of the key, and every provider binds the workspace id into what it
//   wraps (an encryption context, additional authenticated data, or the wrapped bytes themselves).
//   Each answers a refusal (KeyRefusedError: the key's state changes) apart from an outage
//   (KmsUnreachableError: try again). A new provider is one more file and one more entry below.
import type { WorkspaceKeyProvider } from '@freero/shared';
import { seal, unseal } from '../../platform/secrets';
import { awsKms } from './awsKms';
import { azureKeyVault } from './azureKeyVault';
import { gcpKms } from './gcpKms';
import { KeyRefusedError } from './kmsHttp';
import { vaultTransit } from './vaultTransit';

export { KeyRefusedError, KmsUnreachableError } from './kmsHttp';

const INSTANCE_PURPOSE = 'workspace-kek-v1';

export interface KmsProvider {
  id: Exclude<WorkspaceKeyProvider, 'instance'>;
  /** How people know it ("Google Cloud KMS"), for messages. */
  name: string;
  /** Whether this server has the credentials to call it. */
  configured(): boolean;
  /** The key id as stored, when `s` is one of this provider's (an ARN, a key name, a key URL, a key path); else null. */
  parseKeyId(s: string): string | null;
  wrap(keyId: string, workspaceId: string, dek: Buffer): Promise<string>;
  /** The 32-byte data key. Throws KeyRefusedError when it isn't this workspace's, or the key may not be used. */
  unwrap(keyId: string, workspaceId: string, wrapped: string): Promise<Buffer>;
}

/** Every external provider, in the order the admin console offers them. */
export const KMS_PROVIDERS: readonly KmsProvider[] = [awsKms, gcpKms, azureKeyVault, vaultTransit];

const providerOf = (id: WorkspaceKeyProvider): KmsProvider => {
  const p = KMS_PROVIDERS.find((k) => k.id === id);
  if (!p) throw new KeyRefusedError(`unknown key provider ${id}`);
  return p;
};

/** The provider whose key id `s` is, and the id as stored; null when it is nobody's. */
export function parseKmsKeyId(s: string): { provider: KmsProvider; keyId: string } | null {
  for (const provider of KMS_PROVIDERS) {
    const keyId = provider.parseKeyId(s);
    if (keyId) return { provider, keyId };
  }
  return null;
}

export interface KekRef {
  provider: WorkspaceKeyProvider;
  /** The key at its provider (null for 'instance'). */
  kmsKeyId: string | null;
}

/** What the stored data key names as the key that wrapped it. */
export const kekRefOf = (k: KekRef): string => (k.provider === 'instance' ? 'instance' : k.kmsKeyId!);

export async function wrapDataKey(k: KekRef, workspaceId: string, dek: Buffer): Promise<string> {
  if (k.provider === 'instance') return seal(INSTANCE_PURPOSE, `${workspaceId}.${dek.toString('base64url')}`);
  return providerOf(k.provider).wrap(k.kmsKeyId!, workspaceId, dek);
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
  const dek = await providerOf(k.provider).unwrap(k.kmsKeyId!, workspaceId, wrapped);
  if (dek.length !== 32) throw new KeyRefusedError('the key service returned a key of the wrong size');
  return { dek, stale: false };
}
