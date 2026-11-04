// A workspace's own key at Google Cloud KMS, Azure Key Vault or HashiCorp Vault Transit (#159),
// against stand-ins that check what the real services check: the Google token endpoint verifies
// the service account's signed JWT, Key Vault wraps with a real RSA-OAEP-256 key behind a
// client-credentials token, Vault Transit encrypts with AES-GCM behind its token. Each can refuse
// a key (access revoked) or be down; only a refusal may close a workspace.
import { createCipheriv, createDecipheriv, generateKeyPairSync, privateDecrypt, publicEncrypt, randomBytes, verify, constants } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as Y from 'yjs';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { initBoardDoc, storedBoardView } from '../realtime/index';
import { boardAccess, createTeamWorkspace } from '../workspaces/index';
import { KeyRefusedError, unwrapDataKey, wrapDataKey, type KekRef } from './kek';
import { checkKeys, createKey, forgetAllCachedKeys, keyStatus } from './service';

const GCP_KEY = 'projects/acme-prod/locations/europe-west1/keyRings/freero/cryptoKeys/workspace';
const AZURE_KEY = 'https://acme-vault.vault.azure.net/keys/freero-workspace';
const VAULT_KEY = 'transit/keys/acme';

const sa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const vaultRsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const vaultAes = randomBytes(32);
const AZURE_VERSION = 'a'.repeat(32);

/** What each stand-in does right now: refuse the key (access revoked) or be down. */
const state = { refused: new Set<string>(), down: new Set<string>(), tokens: new Set<string>() };
let base = '';
let server: http.Server;

const json = (res: http.ServerResponse, status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
const bearer = (req: http.IncomingMessage) => state.tokens.has(String(req.headers.authorization ?? '').replace(/^Bearer /, ''));

function gcp(req: http.IncomingMessage, res: http.ServerResponse, path: string, body: string) {
  if (path === '/gcp-token') {
    const form = new URLSearchParams(body);
    const [h, c, s] = (form.get('assertion') ?? '').split('.');
    const claims = JSON.parse(Buffer.from(c ?? '', 'base64url').toString() || '{}') as { aud?: string; scope?: string; iss?: string };
    const signed = !!s && verify('RSA-SHA256', Buffer.from(`${h}.${c}`), sa.publicKey, Buffer.from(s, 'base64url'));
    if (form.get('grant_type') !== 'urn:ietf:params:oauth:grant-type:jwt-bearer' || !signed || claims.aud !== `${base}/gcp-token` || claims.scope !== 'https://www.googleapis.com/auth/cloudkms' || claims.iss !== 'freero@acme.iam.gserviceaccount.com')
      return json(res, 400, { error: 'invalid_grant' });
    const token = `gcp-${randomBytes(6).toString('hex')}`;
    state.tokens.add(token);
    return json(res, 200, { access_token: token, expires_in: 3599, token_type: 'Bearer' });
  }
  if (state.down.has('gcp-kms')) return json(res, 503, { error: { code: 503, status: 'UNAVAILABLE', message: 'try later' } });
  if (!bearer(req)) return json(res, 401, { error: { code: 401, status: 'UNAUTHENTICATED' } });
  const m = /^\/gcp\/v1\/(.+):(encrypt|decrypt)$/.exec(path);
  if (!m || m[1] !== GCP_KEY) return json(res, 404, { error: { code: 404, status: 'NOT_FOUND' } });
  if (state.refused.has('gcp-kms')) return json(res, 403, { error: { code: 403, status: 'PERMISSION_DENIED', message: 'cloudkms.cryptoKeyVersions.useToDecrypt denied' } });
  const b = JSON.parse(body) as { plaintext?: string; ciphertext?: string; additionalAuthenticatedData?: string };
  if (m[2] === 'encrypt') return json(res, 200, { ciphertext: Buffer.from(JSON.stringify({ aad: b.additionalAuthenticatedData, p: b.plaintext })).toString('base64') });
  const sealed = JSON.parse(Buffer.from(b.ciphertext ?? '', 'base64').toString()) as { aad: string; p: string };
  if (sealed.aad !== b.additionalAuthenticatedData) return json(res, 400, { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Decryption failed' } });
  return json(res, 200, { plaintext: sealed.p });
}

function azure(req: http.IncomingMessage, res: http.ServerResponse, path: string, body: string) {
  if (path === '/azure-login/tenant-1/oauth2/v2.0/token') {
    const form = new URLSearchParams(body);
    if (form.get('grant_type') !== 'client_credentials' || form.get('client_id') !== 'app-1' || form.get('client_secret') !== 'app-secret' || form.get('scope') !== 'https://vault.azure.net/.default')
      return json(res, 401, { error: 'invalid_client' });
    const token = `az-${randomBytes(6).toString('hex')}`;
    state.tokens.add(token);
    return json(res, 200, { access_token: token, expires_in: 3599 });
  }
  if (state.down.has('azure-key-vault')) return json(res, 503, { error: { code: 'ServiceUnavailable' } });
  if (!bearer(req)) return json(res, 401, { error: { code: 'Unauthorized' } });
  const m = /^\/keys\/freero-workspace(?:\/([0-9a-f]{32}))?\/(wrapkey|unwrapkey)$/.exec(path);
  if (!m) return json(res, 404, { error: { code: 'KeyNotFound' } });
  if (state.refused.has('azure-key-vault')) return json(res, 403, { error: { code: 'Forbidden', message: 'Operation unwrapKey is not permitted on this key' } });
  const b = JSON.parse(body) as { alg: string; value: string };
  if (b.alg !== 'RSA-OAEP-256') return json(res, 400, { error: { code: 'BadParameter' } });
  const kid = `${AZURE_KEY}/${AZURE_VERSION}`;
  const oaep = { padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
  if (m[2] === 'wrapkey') return json(res, 200, { kid, value: publicEncrypt({ key: vaultRsa.publicKey, ...oaep }, Buffer.from(b.value, 'base64url')).toString('base64url') });
  if (m[1] !== AZURE_VERSION) return json(res, 400, { error: { code: 'BadParameter' } });
  try {
    return json(res, 200, { kid, value: privateDecrypt({ key: vaultRsa.privateKey, ...oaep }, Buffer.from(b.value, 'base64url')).toString('base64url') });
  } catch {
    return json(res, 400, { error: { code: 'BadParameter', message: 'decryption failed' } });
  }
}

function vault(req: http.IncomingMessage, res: http.ServerResponse, path: string, body: string) {
  if (state.down.has('vault-transit')) return json(res, 503, { errors: ['Vault is sealed'] });
  if (req.headers['x-vault-token'] !== 'vault-token') return json(res, 403, { errors: ['permission denied'] });
  const m = /^\/vault\/v1\/transit\/(encrypt|decrypt)\/acme$/.exec(path);
  if (!m) return json(res, 400, { errors: ['encryption key not found'] });
  if (state.refused.has('vault-transit')) return json(res, 403, { errors: ['1 error occurred:\n\t* permission denied'] });
  const b = JSON.parse(body) as { plaintext?: string; ciphertext?: string };
  if (m[1] === 'encrypt') {
    const nonce = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', vaultAes, nonce);
    const ct = Buffer.concat([c.update(Buffer.from(b.plaintext ?? '', 'base64')), c.final()]);
    return json(res, 200, { data: { ciphertext: `vault:v1:${Buffer.concat([nonce, ct, c.getAuthTag()]).toString('base64')}` } });
  }
  const raw = Buffer.from(String(b.ciphertext).replace(/^vault:v1:/, ''), 'base64');
  const d = createDecipheriv('aes-256-gcm', vaultAes, raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(raw.length - 16));
  return json(res, 200, { data: { plaintext: Buffer.concat([d.update(raw.subarray(12, raw.length - 16)), d.final()]).toString('base64') } });
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      if (path.startsWith('/gcp')) return gcp(req, res, path, body);
      if (path.startsWith('/vault')) return vault(req, res, path, body);
      return azure(req, res, path, body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await openTestDb({
    WORKSPACE_KEYS: 'true',
    WORKSPACE_KEY_CACHE_SECONDS: '300',
    KMS_GCP_CREDENTIALS: JSON.stringify({
      type: 'service_account',
      client_email: 'freero@acme.iam.gserviceaccount.com',
      private_key: sa.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      token_uri: `${base}/gcp-token`,
    }),
    KMS_GCP_ENDPOINT: `${base}/gcp/`,
    KMS_AZURE_TENANT_ID: 'tenant-1',
    KMS_AZURE_CLIENT_ID: 'app-1',
    KMS_AZURE_CLIENT_SECRET: 'app-secret',
    KMS_AZURE_AUTHORITY: `${base}/azure-login/`,
    KMS_AZURE_ENDPOINT: base,
    KMS_VAULT_ADDR: `${base}/vault`,
    KMS_VAULT_TOKEN: 'vault-token',
  });
});
afterAll(async () => {
  await closeTestDb();
  await new Promise((r) => server.close(r));
});
beforeEach(() => {
  state.refused.clear();
  state.down.clear();
});

const PROVIDERS = [
  ['Google Cloud KMS', 'gcp-kms', GCP_KEY],
  ['Azure Key Vault', 'azure-key-vault', AZURE_KEY],
  ['Vault Transit', 'vault-transit', VAULT_KEY],
] as const;

let n = 0;
it.each(PROVIDERS)(
  "%s: a workspace's key there seals its boards; an outage leaves them open, a refusal (access revoked) closes them although the data key is cached, and restored access reopens them on a fresh instance",
  async (_name, provider, keyId) => {
    const me = await createUser({ name: 'Customer', email: `kms${++n}@providers.test.freero.app`, password: 'password-123' }, { emailVerified: true });
    const ws = (await createTeamWorkspace(me.id, `Regulated ${n}`)).id;
    const status = await createKey(ws, me.id, { kmsKeyId: keyId });
    expect(status.key).toMatchObject({ provider, kmsKeyId: keyId, state: 'active' });
    const board = await createBoard(me.id, 'Ledger', '', 'none', { workspaceId: ws });
    const doc = new Y.Doc();
    doc.getMap('elements').set('s1', { id: 's1', type: 'sticky', x: 0, y: 0, w: 1, h: 1, text: 'account 4711' });
    await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
    expect((await storedBoardView(board.id))?.elements).toHaveLength(1);

    state.down.add(provider);
    await checkKeys();
    expect((await keyStatus(ws, me.id)).key?.state).toBe('active');

    state.down.clear();
    state.refused.add(provider);
    await checkKeys();
    expect((await keyStatus(ws, me.id)).key?.state).toBe('unavailable');
    expect((await boardAccess(me.id, { workspaceId: ws, projectId: null })).blocked).toBe('key_unavailable');
    expect(await storedBoardView(board.id)).toBeNull();

    state.refused.clear();
    await checkKeys();
    forgetAllCachedKeys(); // another instance: the data key comes from the provider again
    expect((await storedBoardView(board.id))?.elements).toHaveLength(1);
  },
);

it.each(PROVIDERS)('%s: a data key wrapped for one workspace never unwraps for another (a wrapped key copied between rows opens nothing)', async (_name, provider, keyId) => {
  const kek: KekRef = { provider, kmsKeyId: keyId };
  const dek = randomBytes(32);
  const wrapped = await wrapDataKey(kek, 'ws-alpha', dek);
  expect((await unwrapDataKey(kek, 'ws-alpha', wrapped)).dek.equals(dek)).toBe(true);
  await expect(unwrapDataKey(kek, 'ws-beta', wrapped)).rejects.toBeInstanceOf(KeyRefusedError);
});
