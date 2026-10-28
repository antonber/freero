// Flows built on single-use emailed tokens: email verification, password reset, email change (and
// undoing one from the previous address).
// Tokens are 256-bit random values; only their sha256 is stored, and using one deletes it.
// Nothing here tells a caller whether an address has an account.
import type { Request } from 'express';
import type { Account } from '@freero/shared';
import { appUrl, renderMail, sendMail, sendMailLater } from '../../platform/mail';
import { badRequest, HttpError } from '../../platform/http';
import { logError } from '../../platform/log';
import { sendSecurityNotice } from './notices';
import { hashPassword } from './password';
import * as repo from './repo';
import {
  confirmPassword,
  emailVerified,
  endSessionsOf,
  getAccount,
  hashToken,
  markEmailVerified,
  newToken,
  normalizeEmail,
  validEmail,
  validatePassword,
} from './service';

const HOUR = 3_600_000;
export const VERIFY_TTL_MS = 48 * HOUR;
export const RESET_TTL_MS = 30 * 60_000;
export const CHANGE_EMAIL_TTL_MS = 24 * HOUR;
const REVERT_EMAIL_DAYS = 7;

const invalidLink = () => badRequest('This link is invalid or has expired. Request a new one.');

async function issue(userId: string, purpose: repo.TokenPurpose, email: string, ttlMs: number): Promise<string> {
  // One live link per purpose: asking again invalidates the previous one.
  await repo.deleteTokens(userId, purpose);
  const token = newToken();
  const now = Date.now();
  await repo.insertToken({ tokenHash: hashToken(token), userId, purpose, email, now, expiresAt: now + ttlMs });
  return token;
}

// ---- verification ----

/** Emails a verification link to the account's current address (no-op once verified). */
export async function sendVerification(req: Request | null, user: Account): Promise<void> {
  if (user.emailVerified) return;
  const token = await issue(user.id, 'verify_email', user.email, VERIFY_TTL_MS);
  await sendMail({
    to: user.email,
    ...renderMail({
      subject: 'Confirm your email for Freero',
      title: `Welcome to Freero, ${user.name}`,
      paragraphs: ['Confirm that this is your email address so you can invite people and share boards.'],
      action: { label: 'Confirm email', url: appUrl(req, `/verify-email?token=${token}`) },
      outro: 'The link works once and expires in 48 hours. If you did not create a Freero account, ignore this message.',
    }),
  });
}

export async function verifyEmail(tokenIn: unknown): Promise<void> {
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  const t = token ? await repo.takeToken(hashToken(token), 'verify_email', Date.now()) : null;
  // A link for an address the account no longer uses verifies nothing.
  if (!t || !(await markEmailVerified(t.userId, t.email))) throw invalidLink();
}

// ---- password reset ----

/**
 * Starts a reset for whatever account uses `email`, if any. Runs after the response is sent, so
 * neither the answer nor its timing says whether the account exists.
 */
export function requestPasswordReset(req: Request | null, emailIn: unknown): void {
  const email = normalizeEmail(emailIn);
  if (!validEmail(email)) return;
  void (async () => {
    const user = await repo.findUserByEmail(email);
    if (!user) return;
    const token = await issue(user.id, 'reset_password', user.email, RESET_TTL_MS);
    sendMailLater({
      to: user.email,
      ...renderMail({
        subject: 'Reset your Freero password',
        title: 'Reset your password',
        paragraphs: [`Someone (hopefully you) asked to reset the password of the Freero account for ${user.email}.`],
        action: { label: 'Choose a new password', url: appUrl(req, `/reset-password?token=${token}`) },
        outro: 'The link works once and expires in 30 minutes. If you did not ask for this, ignore this message: your password stays the same.',
      }),
    });
  })().catch((e) => logError('auth: password reset request failed', e));
}

/** Sets a new password from a reset link and ends every session of the account. Returns the account. */
export async function resetPassword(req: Request | null, tokenIn: unknown, passwordIn: unknown): Promise<Account> {
  const password = validatePassword(passwordIn);
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  const t = token ? await repo.takeToken(hashToken(token), 'reset_password', Date.now()) : null;
  if (!t) throw invalidLink();
  // The mailbox, not the old password, chose it: it can't start a two-step recovery (recovery.ts).
  await repo.setPasswordHash(t.userId, await hashPassword(password), { viaLink: true });
  await endSessionsOf(t.userId);
  // Reading the reset mail proves the address.
  await markEmailVerified(t.userId, t.email);
  const account = await getAccount(t.userId);
  sendSecurityNotice(req, account.email, { kind: 'password_reset' });
  return account;
}

/**
 * Changes the password of a signed-in user — or sets the first one of an account that signed up
 * through a provider (then a recent sign-in stands in for the current password, `sessionAuthAt`).
 * Every other session of theirs ends.
 */
export async function changePassword(
  req: Request | null,
  userId: string,
  currentSessionKey: string,
  current: unknown,
  next: unknown,
  sessionAuthAt?: number,
): Promise<void> {
  const password = validatePassword(next);
  const user = await confirmPassword(userId, current, sessionAuthAt);
  await repo.setPasswordHash(userId, await hashPassword(password));
  await repo.deleteTokens(userId, 'reset_password');
  await endSessionsOf(userId, currentSessionKey);
  sendSecurityNotice(req, user.email, { kind: user.passwordHash ? 'password_changed' : 'password_set' });
}

// ---- email change ----

/** Sends a confirmation link to the NEW address; the account keeps its address until it is used. */
export async function requestEmailChange(
  req: Request | null,
  userId: string,
  emailIn: unknown,
  password: unknown,
  sessionAuthAt?: number,
): Promise<void> {
  const email = normalizeEmail(emailIn);
  if (!validEmail(email)) throw badRequest('Please enter a valid email address');
  const user = await confirmPassword(userId, password, sessionAuthAt);
  if (email === user.email) throw badRequest('That is already your email address');
  const token = await issue(user.id, 'change_email', email, CHANGE_EMAIL_TTL_MS);
  await sendMail({
    to: email,
    ...renderMail({
      subject: 'Confirm your new Freero email address',
      title: 'Confirm your new email address',
      paragraphs: [`${user.name} asked to use this address for their Freero account.`],
      action: { label: 'Use this address', url: appUrl(req, `/confirm-email?token=${token}`) },
      outro: 'The link works once and expires in 24 hours. If this was not you, ignore this message.',
    }),
  });
  sendMailLater({
    to: user.email,
    ...renderMail({
      subject: 'Your Freero email address is being changed',
      title: 'Email change requested',
      paragraphs: [
        `We sent a confirmation link to ${email}. Your account keeps using ${user.email} until that link is opened.`,
        'If this was not you, change your password now: it also signs out every other device.',
      ],
    }),
  });
}

/**
 * Applies an email change from the link sent to the new address. The previous address, if it was
 * verified, gets a notice with a "this wasn't me" link (revertEmailChange) — never an unverified
 * one: whoever reads it may not be the account's owner.
 */
export async function confirmEmailChange(req: Request | null, tokenIn: unknown): Promise<void> {
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  const t = token ? await repo.takeToken(hashToken(token), 'change_email', Date.now()) : null;
  if (!t) throw invalidLink();
  const before = await repo.findUserById(t.userId);
  const now = Date.now();
  try {
    if (!before || !(await repo.changeEmail(t.userId, t.email, now))) throw invalidLink();
  } catch (e) {
    if (e instanceof repo.EmailTakenError) throw new HttpError(409, 'Another account uses that address now');
    throw e;
  }
  await repo.deleteTokens(t.userId, 'verify_email'); // links for the old address
  await emailVerified(t.userId, t.email);
  if (!before.emailVerified || before.email === t.email) return;
  // Not through issue(): a second change must not cancel the first address's way back.
  const revert = newToken();
  await repo.insertToken({
    tokenHash: hashToken(revert),
    userId: t.userId,
    purpose: 'revert_email',
    email: before.email,
    now,
    expiresAt: now + REVERT_EMAIL_DAYS * 24 * HOUR,
  });
  sendSecurityNotice(
    req,
    before.email,
    { kind: 'email_changed', newEmail: t.email, revertUrl: appUrl(req, `/revert-email?token=${revert}`), validDays: REVERT_EMAIL_DAYS },
    now,
  );
}

/**
 * "This wasn't me", from the link an email change sent to the previous address: moves the account
 * back to that address, sets a new password, removes the two-step verification and provider
 * sign-ins set up since the change, cancels every pending link and ends every session. Returns the
 * account (the caller signs this browser in, through the second step if one is still on).
 */
export async function revertEmailChange(tokenIn: unknown, passwordIn: unknown): Promise<Account> {
  const password = validatePassword(passwordIn); // before using the link up
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  const t = token ? await repo.takeToken(hashToken(token), 'revert_email', Date.now()) : null;
  if (!t) throw invalidLink();
  try {
    if (!(await repo.changeEmail(t.userId, t.email, Date.now()))) throw invalidLink();
  } catch (e) {
    if (e instanceof repo.EmailTakenError) throw new HttpError(409, 'Another account uses that address now');
    throw e;
  }
  await repo.setPasswordHash(t.userId, await hashPassword(password), { viaLink: true });
  await repo.removeSecuritySetupSince(t.userId, t.createdAt);
  // Every pending link, other "this wasn't me" links included — except the two-step-on notice's
  // undo link sent to this same address (two-step verification turned on BEFORE the change stays
  // on; that link is how this address removes it, see recovery.ts).
  await repo.deleteTokensExcept(t.userId, [{ purpose: 'two_factor_undo', email: t.email }]);
  await endSessionsOf(t.userId);
  await emailVerified(t.userId, t.email);
  return getAccount(t.userId);
}
