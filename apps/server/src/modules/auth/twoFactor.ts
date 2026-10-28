// Two-factor authentication: an authenticator app (TOTP, RFC 6238 via otplib) plus 10 single-use
// recovery codes. The TOTP secret is stored encrypted (AES-256-GCM, key derived from
// SESSION_SECRET); recovery codes only as sha256 (they are random, so no slow hash is needed).
// A code's time step is accepted once (replay guard), and a recovery code once.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, randomInt } from 'node:crypto';
import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';
import type { TwoFactorSetup } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError } from '../../platform/http';
import { logError } from '../../platform/log';
import * as repo from './repo';
import { confirmPassword, endSessionsOf } from './service';

export const RECOVERY_CODE_COUNT = 10;
const ISSUER = 'Freero';
/** Accept the previous and next 30 s code too (clock drift between phone and server). */
const EPOCH_TOLERANCE_S = 30;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i
const RECOVERY_LENGTH = 10; // ~49.5 bits each

// ---- secret at rest ----

function secretKey(): Buffer {
  return Buffer.from(hkdfSync('sha256', getConfig().sessionSecret, 'freero', 'two-factor-secret-v1', 32));
}

export function sealSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** The plain secret, or null when it can't be decrypted (SESSION_SECRET changed since enrolment). */
export function openSecret(sealed: string): string | null {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || data === undefined) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', secretKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// ---- recovery codes ----

/** "abcde-fghjk" — what the user writes down. */
function newRecoveryCode(): string {
  let code = '';
  for (let i = 0; i < RECOVERY_LENGTH; i++) code += RECOVERY_ALPHABET[randomInt(RECOVERY_ALPHABET.length)];
  return `${code.slice(0, 5)}-${code.slice(5)}`;
}

/** Case, spaces and dashes don't matter when typing a recovery code back. */
const normalizeRecoveryCode = (code: string) => code.toLowerCase().replace(/[\s-]/g, '');
const hashRecoveryCode = (code: string) => createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');

function newRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

// ---- policy seam (workspace-enforced two-factor, Enterprise) ----

type RequirementCheck = (userId: string) => Promise<string | null> | string | null;
const requirementChecks = new Set<RequirementCheck>();

/**
 * Lets another module require two-factor for a user (a workspace policy): the check returns a
 * reason to show ("Acme requires two-step verification") or null. A required authenticator can't
 * be turned off; enforcing enrolment at sign-in is up to the policy owner.
 */
export function onTwoFactorRequirement(fn: RequirementCheck): () => void {
  requirementChecks.add(fn);
  return () => requirementChecks.delete(fn);
}

export async function twoFactorRequiredBy(userId: string): Promise<string | null> {
  for (const fn of requirementChecks) {
    try {
      const reason = await fn(userId);
      if (reason) return reason;
    } catch (e) {
      logError('auth: a two-factor requirement check failed', e);
    }
  }
  return null;
}

// ---- codes ----

const codeOf = (input: unknown) => (typeof input === 'string' ? input.trim() : '');

async function checkTotp(secretSealed: string, token: string, afterTimeStep: number | null): Promise<number | null> {
  const secret = openSecret(secretSealed);
  if (!secret) return null;
  const r = await verify({ secret, token, epochTolerance: EPOCH_TOLERANCE_S, ...(afterTimeStep === null ? {} : { afterTimeStep }) });
  return r.valid && 'timeStep' in r ? r.timeStep : null;
}

/**
 * Checks a second-factor code of a user with two-factor on and uses it up: a 6-digit authenticator
 * code (each time step once) or a recovery code (each once). Returns which kind worked, or null.
 */
export async function useSecondFactor(userId: string, input: unknown): Promise<'totp' | 'recovery' | null> {
  const code = codeOf(input).replace(/\s/g, '');
  if (/^\d{6}$/.test(code)) {
    const totp = await repo.findTotp(userId);
    if (!totp || totp.enabledAt === null) return null;
    const step = await checkTotp(totp.secret, code, totp.lastTimeStep);
    return step !== null && (await repo.useTotpStep(userId, step)) ? 'totp' : null;
  }
  if (normalizeRecoveryCode(code).length !== RECOVERY_LENGTH) return null;
  return (await repo.useRecoveryCode(userId, hashRecoveryCode(code), Date.now())) ? 'recovery' : null;
}

const wrongCode = () => new HttpError(403, 'That code is not right. Check your authenticator app and try again.');

// ---- enrolment and management (signed in) ----

/** Starts enrolment: a new secret (replacing an unfinished one) and its QR code. */
export async function beginTwoFactorSetup(userId: string, password: unknown, sessionAuthAt: number): Promise<TwoFactorSetup> {
  const user = await confirmPassword(userId, password, sessionAuthAt);
  if (await repo.twoFactorEnabled(userId)) throw new HttpError(409, 'Two-step verification is already on');
  const secret = generateSecret();
  if (!(await repo.savePendingTotp(userId, sealSecret(secret), Date.now())))
    throw new HttpError(409, 'Two-step verification is already on');
  const uri = generateURI({ issuer: ISSUER, label: user.email, secret });
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 216, errorCorrectionLevel: 'M' });
  return { secret, uri, qr };
}

/**
 * Finishes enrolment with a code from the app (proves it was scanned), turns two-factor on and
 * returns the recovery codes (shown once). Other sessions are signed out: whoever else might be
 * signed in did not pass the new second step.
 */
export async function enableTwoFactor(userId: string, currentSessionKey: string, input: unknown): Promise<string[]> {
  const totp = await repo.findTotp(userId);
  if (!totp || totp.enabledAt !== null) throw new HttpError(409, 'Start the setup again');
  const code = codeOf(input).replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) throw badRequest('Enter the 6-digit code from your authenticator app');
  const step = await checkTotp(totp.secret, code, null);
  if (step === null) throw wrongCode();
  const { codes, hashes } = newRecoveryCodes();
  if (!(await repo.enableTotp(userId, totp.secret, step, hashes, Date.now()))) throw new HttpError(409, 'Start the setup again');
  await endSessionsOf(userId, currentSessionKey);
  return codes;
}

/** Turns two-factor off: the password (or a recent sign-in when there is none) AND a code. */
export async function disableTwoFactor(userId: string, password: unknown, code: unknown, sessionAuthAt: number): Promise<void> {
  const requiredBy = await twoFactorRequiredBy(userId);
  if (requiredBy) throw new HttpError(409, `${requiredBy} — it can’t be turned off`);
  await confirmPassword(userId, password, sessionAuthAt);
  if (!(await repo.twoFactorEnabled(userId))) return;
  if (!(await useSecondFactor(userId, code))) throw wrongCode();
  await repo.deleteTwoFactor(userId);
}

/** New recovery codes (the old ones stop working): the password (or a recent sign-in) AND a code. */
export async function regenerateRecoveryCodes(userId: string, password: unknown, code: unknown, sessionAuthAt: number): Promise<string[]> {
  await confirmPassword(userId, password, sessionAuthAt);
  if (!(await repo.twoFactorEnabled(userId))) throw new HttpError(409, 'Two-step verification is off');
  if (!(await useSecondFactor(userId, code))) throw wrongCode();
  const { codes, hashes } = newRecoveryCodes();
  await repo.replaceRecoveryCodes(userId, hashes);
  return codes;
}
