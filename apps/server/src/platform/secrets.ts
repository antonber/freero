// Everything the server derives from SESSION_SECRET goes through here, so the secret can be
// rotated without breaking what was made under the old one. SESSION_SECRET is the current secret;
// SESSION_SECRET_PREVIOUS lists the ones it replaced. New values are always made with the current
// secret; values made with a previous one are still accepted, and sealed data reports that it is
// stale so its owner can seal it again (see docs/operations.md, "Rotating SESSION_SECRET").
//
//   seal('two-factor-secret-v1', secret) / unseal(…)   AES-256-GCM at rest, key = HKDF(secret, purpose)
//   mac('notifications.unsubscribe:' + id) / macMatches(…, given)   HMAC-SHA256 for signed links
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { getConfig, type Config } from './config';

/** Current secret first, then the previous ones (newest first). */
function secretsOf(config: Config): string[] {
  return [config.sessionSecret, ...config.sessionSecretsPrevious];
}

// Derived keys per loaded config (a reloaded config, e.g. in tests, gets its own).
const derived = new WeakMap<Config, Map<string, Buffer[]>>();

/** One 256-bit key per configured secret for `purpose`, current first. */
function keysFor(purpose: string): Buffer[] {
  const config = getConfig();
  let byPurpose = derived.get(config);
  if (!byPurpose) derived.set(config, (byPurpose = new Map()));
  let keys = byPurpose.get(purpose);
  if (!keys) {
    keys = secretsOf(config).map((s) => Buffer.from(hkdfSync('sha256', s, 'freero', purpose, 32)));
    byPurpose.set(purpose, keys);
  }
  return keys;
}

/** Encrypts `plain` under the current secret: "v1.<iv>.<tag>.<data>" (base64url parts). */
export function seal(purpose: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keysFor(purpose)[0], iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/**
 * Decrypts a sealed value with whichever configured secret made it. `stale`: it was a previous
 * secret, so the caller should store seal(purpose, value) instead. Null when no configured secret
 * opens it (made under a secret that is no longer configured, or tampered with).
 */
export function unseal(purpose: string, sealed: string): { value: string; stale: boolean } | null {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) return null;
  const keys = keysFor(purpose);
  for (let i = 0; i < keys.length; i++) {
    try {
      const decipher = createDecipheriv('aes-256-gcm', keys[i], Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      const value = Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
      return { value, stale: i > 0 };
    } catch {
      // Not this key (the GCM tag doesn't match): try the next one.
    }
  }
  return null;
}

/** HMAC-SHA256 of `message` under the current secret. Prefix messages with their purpose. */
export function mac(message: string): Buffer {
  return createHmac('sha256', getConfig().sessionSecret).update(message).digest();
}

/** Whether `given` is the HMAC of `message` under any configured secret (constant time per secret). */
export function macMatches(message: string, given: Buffer): boolean {
  let ok = false;
  for (const secret of secretsOf(getConfig())) {
    const want = createHmac('sha256', secret).update(message).digest();
    if (given.length === want.length && timingSafeEqual(given, want)) ok = true;
  }
  return ok;
}
