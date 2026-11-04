// Azure Key Vault (or Managed HSM): the workspace's RSA key wraps its data keys (wrapkey /
// unwrapkey, RSA-OAEP-256, REST api-version 7.4). The operator's app registration (KMS_AZURE_*)
// calls it with a client-credentials access token; customers give that app "wrap key" and "unwrap
// key" on their key (an access policy or the Key Vault Crypto Service Encryption User role), and
// removing it, or disabling the key, is how they revoke access. RSA wrapping binds no additional
// data, so what is wrapped is "<workspaceId>.<data key>" (kmsHttp.boundKey).
//
// A key named without a version wraps with its current version; the version that wrapped (the
// answer's `kid`) is stored with the wrapped key, so a customer rotating the key in Azure keeps
// every older data key unwrapping with the version that wrapped it.
import { getConfig } from '../../platform/config';
import type { KmsProvider } from './kek';
import { boundKey, cachedToken, forgetToken, judge, KeyRefusedError, kmsFetch, KmsUnreachableError, unboundKey } from './kmsHttp';

const API_VERSION = '7.4';
const ALG = 'RSA-OAEP-256';
/** https://<vault>.<cloud suffix>/keys/<name>[/<version>]: the public, China and US Government clouds, and Managed HSM. */
const KEY_RE = /^https:\/\/([a-z0-9-]{3,24})\.(vault\.azure\.net|vault\.azure\.cn|vault\.usgovcloudapi\.net|managedhsm\.azure\.net)\/keys\/([A-Za-z0-9-]{1,127})(\/[0-9a-f]{32})?$/i;

function creds() {
  const c = getConfig().workspaceKeys.azureKeyVault;
  if (!c) throw new KeyRefusedError('this server has no Azure Key Vault credentials (KMS_AZURE_CLIENT_ID)');
  return c;
}

/** The OAuth resource of the key's cloud ("https://vault.azure.net"). */
function resourceOf(keyId: string): string {
  const m = KEY_RE.exec(keyId);
  if (!m) throw new KeyRefusedError('not an Azure Key Vault key URL');
  return `https://${m[2].toLowerCase()}`;
}

function accessToken(resource: string): Promise<string> {
  const c = creds();
  const key = `azure:${c.tenantId}:${c.clientId}:${resource}`;
  return cachedToken(key, async () => {
    const body = new URLSearchParams({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret, scope: `${resource}/.default` }).toString();
    const url = `${c.authority.replace(/\/+$/, '')}/${encodeURIComponent(c.tenantId)}/oauth2/v2.0/token`;
    const a = await kmsFetch(url, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body });
    if (a.status !== 200 || typeof a.json.access_token !== 'string') judge(a, 'Microsoft sign-in for Key Vault', String(a.json.error_description ?? a.json.error ?? '').split('\n')[0]);
    return { token: a.json.access_token as string, expiresInSeconds: Number(a.json.expires_in ?? 3600) };
  });
}

/** Where to send a call for `keyUrl` (KMS_AZURE_ENDPOINT replaces the vault's origin: a private endpoint, a test double). */
function requestUrl(keyUrl: string, verb: 'wrapkey' | 'unwrapkey'): string {
  const u = new URL(`${keyUrl}/${verb}`);
  u.searchParams.set('api-version', API_VERSION);
  const override = creds().endpoint;
  if (!override) return u.toString();
  const o = new URL(override);
  return `${o.origin}${u.pathname}${u.search}`;
}

async function call(keyUrl: string, verb: 'wrapkey' | 'unwrapkey', value: string): Promise<{ kid: string; value: string }> {
  const resource = resourceOf(keyUrl);
  const a = await kmsFetch(requestUrl(keyUrl, verb), {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken(resource)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ alg: ALG, value }),
  });
  if (a.status === 200 && typeof a.json.value === 'string' && typeof a.json.kid === 'string') return { kid: a.json.kid, value: a.json.value };
  const err = (a.json.error ?? {}) as { code?: unknown; message?: unknown };
  const detail = `${String(err.code ?? '')} ${String(err.message ?? '')}`.trim();
  if (a.status === 200) throw new KmsUnreachableError(`Key Vault answered ${verb} without a value`);
  if (a.status === 401) {
    forgetToken(`azure:${creds().tenantId}:${creds().clientId}:${resource}`);
    throw new KmsUnreachableError(`Key Vault did not accept the access token: ${detail}`.slice(0, 300));
  }
  return judge(a, 'Key Vault', detail);
}

export const azureKeyVault: KmsProvider = {
  id: 'azure-key-vault',
  name: 'Azure Key Vault',
  configured: () => getConfig().workspaceKeys.azureKeyVault !== null,
  parseKeyId: (s) => (KEY_RE.test(s) ? s.replace(/\/+$/, '') : null),
  async wrap(keyUrl, workspaceId, dek) {
    const out = await call(keyUrl, 'wrapkey', boundKey(workspaceId, dek).toString('base64url'));
    // The version that wrapped it must be the key named (or one of its versions): never another key's.
    if (out.kid !== keyUrl && !out.kid.startsWith(`${keyUrl}/`)) throw new KmsUnreachableError('Key Vault wrapped with another key than the one named');
    return `${out.kid} ${out.value}`;
  },
  async unwrap(keyUrl, workspaceId, wrapped) {
    const space = wrapped.indexOf(' ');
    const kid = space > 0 ? wrapped.slice(0, space) : keyUrl;
    if (kid !== keyUrl && !kid.startsWith(`${keyUrl}/`)) throw new KeyRefusedError('this data key was wrapped by another key');
    const out = await call(kid, 'unwrapkey', wrapped.slice(space + 1));
    return unboundKey(workspaceId, Buffer.from(out.value, 'base64url'));
  },
};
