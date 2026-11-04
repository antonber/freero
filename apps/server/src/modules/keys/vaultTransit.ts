// HashiCorp Vault's Transit secrets engine on the operator's Vault (KMS_VAULT_ADDR, a token whose
// policy allows `update` on <mount>/encrypt/<key> and <mount>/decrypt/<key>): one Transit key per
// workspace, named by its path "<mount>/keys/<name>". Revoking the token's policy for a key, or
// deleting the key, is how access ends. Transit binds no additional data to a non-derived key, so
// what is encrypted is "<workspaceId>.<data key>" (kmsHttp.boundKey). A sealed Vault answers 503:
// unreachable, never a refusal.
import { getConfig } from '../../platform/config';
import type { KmsProvider } from './kek';
import { boundKey, judge, KeyRefusedError, kmsFetch, KmsUnreachableError, unboundKey } from './kmsHttp';

/** "<mount path>/keys/<key name>": the mount may be nested ("secret-engines/transit/keys/acme"). */
const PATH_RE = /^((?:[A-Za-z0-9_-]+\/)*?[A-Za-z0-9_-]+)\/keys\/([A-Za-z0-9_.-]{1,128})$/;

async function call(path: string, verb: 'encrypt' | 'decrypt', body: Record<string, string>): Promise<Record<string, unknown>> {
  const c = getConfig().workspaceKeys.vaultTransit;
  if (!c) throw new KeyRefusedError('this server has no Vault Transit settings (KMS_VAULT_ADDR)');
  const m = PATH_RE.exec(path);
  if (!m) throw new KeyRefusedError('not a Vault Transit key path');
  const url = `${c.addr.replace(/\/+$/, '')}/v1/${m[1]}/${verb}/${encodeURIComponent(m[2])}`;
  const headers: Record<string, string> = { 'x-vault-token': c.token, 'content-type': 'application/json' };
  if (c.namespace) headers['x-vault-namespace'] = c.namespace;
  const a = await kmsFetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = a.json.data as Record<string, unknown> | undefined;
  if (a.status === 200 && data) return data;
  if (a.status === 200) throw new KmsUnreachableError(`Vault answered ${verb} without data`);
  const errors = Array.isArray(a.json.errors) ? a.json.errors.map(String).join('; ') : '';
  return judge(a, 'Vault Transit', errors);
}

export const vaultTransit: KmsProvider = {
  id: 'vault-transit',
  name: 'HashiCorp Vault Transit',
  configured: () => getConfig().workspaceKeys.vaultTransit !== null,
  parseKeyId: (s) => (PATH_RE.test(s) && !s.startsWith('arn:') ? s : null),
  async wrap(path, workspaceId, dek) {
    const out = await call(path, 'encrypt', { plaintext: boundKey(workspaceId, dek).toString('base64') });
    if (typeof out.ciphertext !== 'string' || !out.ciphertext.startsWith('vault:')) throw new KmsUnreachableError('Vault answered encrypt without a ciphertext');
    return out.ciphertext;
  },
  async unwrap(path, workspaceId, wrapped) {
    const out = await call(path, 'decrypt', { ciphertext: wrapped });
    if (typeof out.plaintext !== 'string') throw new KmsUnreachableError('Vault answered decrypt without a plaintext');
    return unboundKey(workspaceId, Buffer.from(out.plaintext, 'base64'));
  },
};
