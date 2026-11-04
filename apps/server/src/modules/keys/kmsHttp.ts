// What every external key service call shares (#159): one bounded request, its answer judged as
// "this key may not be used" (KeyRefusedError: the key's state changes) or "ask again later"
// (KmsUnreachableError: nothing changes), and access tokens cached until shortly before they expire.
// No SDKs: each provider is a handful of JSON calls, signed or authorised in-house.

/** The KMS (or the instance) answered: this key can't be used (disabled, deleted, access revoked, not ours). */
export class KeyRefusedError extends Error {}
/** The KMS couldn't be asked (network, timeout, throttling, 5xx): try again later. */
export class KmsUnreachableError extends Error {}

const TIMEOUT_MS = 5000;

export interface KmsAnswer {
  status: number;
  json: Record<string, unknown>;
}

/**
 * One request to a key service (never following redirects: a key service that redirects is
 * misconfigured, and a credential must never reach another host). Network failures and timeouts
 * are KmsUnreachableError; any answer is returned for the provider to judge.
 */
export async function kmsFetch(url: URL | string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<KmsAnswer> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: 'error' });
  } catch (e) {
    throw new KmsUnreachableError(`the key service could not be reached: ${(e as Error).message}`);
  }
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    const parsed = text ? (JSON.parse(text) as unknown) : {};
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) json = parsed as Record<string, unknown>;
  } catch {
    // not JSON: judged by the status
  }
  return { status: res.status, json };
}

/**
 * The usual HTTP reading of a key service's error: 401 / 403 / 404 and other 4xx answers are about
 * the key or our access to it (refused), except 408 / 429 (try again); 5xx is an outage.
 */
export function judge(answer: KmsAnswer, what: string, detail: string): never {
  const message = `${what}: ${detail || `HTTP ${answer.status}`}`.slice(0, 300);
  if (answer.status >= 400 && answer.status < 500 && answer.status !== 408 && answer.status !== 429) throw new KeyRefusedError(message);
  throw new KmsUnreachableError(message);
}

/** Bearer tokens per credential, reused until a minute before they expire. */
const tokens = new Map<string, { token: string; until: number }>();

export async function cachedToken(cacheKey: string, mint: () => Promise<{ token: string; expiresInSeconds: number }>): Promise<string> {
  const hit = tokens.get(cacheKey);
  if (hit && hit.until > Date.now()) return hit.token;
  const { token, expiresInSeconds } = await mint();
  tokens.set(cacheKey, { token, until: Date.now() + Math.max(0, expiresInSeconds - 60) * 1000 });
  return token;
}

/** A token the key service no longer accepts (revoked credentials): mint a new one next time. */
export function forgetToken(cacheKey: string): void {
  tokens.delete(cacheKey);
}

/**
 * Providers that can't bind additional data to a ciphertext (Azure Key Vault's RSA wrap, Vault
 * Transit without derived keys) wrap "<workspaceId>.<data key>" instead, like the instance's key:
 * a wrapped key copied to another workspace's row unwraps to a name that isn't its own and is refused.
 */
export const boundKey = (workspaceId: string, dek: Buffer): Buffer => Buffer.concat([Buffer.from(`${workspaceId}.`, 'utf8'), dek]);

export function unboundKey(workspaceId: string, plain: Buffer): Buffer {
  const prefix = Buffer.from(`${workspaceId}.`, 'utf8');
  if (plain.length !== prefix.length + 32 || !plain.subarray(0, prefix.length).equals(prefix)) throw new KeyRefusedError('this data key belongs to another workspace');
  return Buffer.from(plain.subarray(prefix.length));
}
