// Ways back into an account whose two-step verification its owner can't pass (KAI-99). The threat
// model and why these three exist together are in ARCHITECTURE.md ("Two-step verification
// recovery"). In short:
//   (a) undo   — the two-step-on notice to a VERIFIED address carries a "this wasn't me" link for
//                TWO_FACTOR_UNDO_HOURS: someone with the password locked the account with their
//                own authenticator; whoever reads the address takes it back.
//   (b) delay  — "Lost access to your authenticator?": started after the password (one not set
//                through an emailed link) or an already-connected provider, finished after
//                TWO_FACTOR_RECOVERY_DELAY_SECONDS with a link mailed to the address. Mailed at the
//                start, before the end and when ready; any use of the second factor, a signed-in
//                device or the mailed link cancels it.
//   (c) operator — `npm run admin -- two-factor:reset` (admin.ts) after an out-of-band identity check.
// Taking an account back always: removes two-step verification and every provider sign-in, sets the
// password (none for the operator: the owner picks one through the address), cancels pending links
// (but not an email change's way back to the previous address) and ends every session.
import type { Request } from 'express';
import { RECOVERY_NEEDS_PASSWORD, type Account } from '@freero/shared';
import { audit } from '../../platform/audit';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, unauthorized } from '../../platform/http';
import { appUrl } from '../../platform/mail';
import { consumeRateLimit } from '../../platform/rateLimit';
import { requestOrigin, sendSecurityNotice } from './notices';
import { hashPassword } from './password';
import * as repo from './repo';
import { endSessionsOf, getAccount, hashToken, markEmailVerified, newToken, normalizeEmail, validatePassword } from './service';

const DAY = 86_400_000;
/** How long the link that finishes a ready recovery works. */
const FINISH_LINK_DAYS = 7;
const CANCEL_LINK_MS = 90 * DAY; // outlives any recovery delay; a cancelled recovery deletes it
const JOB_BATCH = 100;

const invalidLink = () => badRequest('This link is invalid or has expired.');

async function insertLink(userId: string, purpose: repo.TokenPurpose, email: string, now: number, expiresAt: number): Promise<string> {
  const token = newToken();
  await repo.insertToken({ tokenHash: hashToken(token), userId, purpose, email, now, expiresAt });
  return token;
}

// ---- (a) "this wasn't me" after two-step verification was turned on ----

/**
 * The undo link for the enrolment that just happened at `enabledAt`, or null when the address
 * isn't verified (whoever reads an unproven address may not be the owner). Replaces an earlier one.
 */
export async function undoLinkFor(req: Request | null, user: Account, enabledAt: number): Promise<string | null> {
  if (!user.emailVerified) return null;
  await repo.deleteTokens(user.id, 'two_factor_undo');
  const token = await insertLink(user.id, 'two_factor_undo', user.email, enabledAt, enabledAt + getConfig().twoFactorUndoMs);
  return appUrl(req, `/undo-two-factor?token=${token}`);
}

/** Uses the undo link: takes the account back with `password` as its new password. Returns the account. */
export async function undoTwoFactor(req: Request | null, tokenIn: unknown, passwordIn: unknown): Promise<Account> {
  const password = validatePassword(passwordIn); // before using the link up
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  if (!token) throw invalidLink();
  const r = await repo.undoTwoFactorEnrolment(hashToken(token), await hashPassword(password), Date.now());
  if (r.result === 'address_changed')
    throw new HttpError(
      409,
      'This account’s email address was changed after two-step verification was turned on. Use the “restore my address” link we sent to this address first, then this link again.',
    );
  if (r.result !== 'done') throw invalidLink();
  await endSessionsOf(r.userId);
  await markEmailVerified(r.userId, r.email);
  sendSecurityNotice(req, r.email, { kind: 'two_factor_undone' });
  await audit({ action: 'auth.two_factor.undone', actor: { kind: 'link', purpose: 'two_factor_undo' }, userId: r.userId });
  return getAccount(r.userId);
}

// ---- (b) delayed recovery: "Lost access to your authenticator?" ----

const needsOwnPassword = () =>
  new HttpError(
    403,
    'To recover without your authenticator, log in with your current password (not a reset link) or with a sign-in provider already connected to your account. If you lost your password too, ask whoever runs your Freero to check who you are.',
    RECOVERY_NEEDS_PASSWORD,
  );

/**
 * Starts a recovery from a pending sign-in (the first factor is proven, the second is not). The
 * first factor must be one the mailbox alone can't produce: the account's password when it was not
 * set through an emailed link since a sign-in last passed the second step, or a provider identity
 * that was already connected. Starting again while one runs returns it (no new mail).
 */
export async function startTwoFactorRecovery(req: Request, challenge: repo.Challenge): Promise<{ readyAt: number }> {
  const user = await repo.findUserById(challenge.userId);
  if (!user) throw unauthorized('Your sign-in expired. Please log in again.');
  const ownFactor = challenge.method === 'password' ? !user.passwordViaLink : challenge.method !== 'email_link' && challenge.link === null;
  if (!ownFactor) throw needsOwnPassword();
  await consumeRateLimit('twoFactorRecovery', `user:${user.id}`);
  const now = Date.now();
  const started = await repo.startRecovery(user.id, now, now + getConfig().twoFactorRecoveryDelayMs, requestOrigin(req));
  if (!started) throw new HttpError(409, 'Two-step verification is off for this account now. Log in again.');
  const { recovery, created } = started;
  if (created) {
    const cancel = await insertLink(user.id, 'two_factor_recovery_cancel', user.email, now, now + CANCEL_LINK_MS);
    sendSecurityNotice(req, user.email, { kind: 'two_factor_recovery_started', readyAt: recovery.readyAt, cancelUrl: appUrl(req, `/cancel-recovery?token=${cancel}`) }, now);
    await audit({ action: 'auth.two_factor.recovery_started', actor: { kind: 'user', userId: user.id }, userId: user.id, detail: { method: challenge.method } });
  }
  return { readyAt: recovery.readyAt };
}

type CancelHow = 'second_step' | 'signed_in' | 'link';

/** Cancels the recovery in progress (if any) and mails the owner. True when there was one. */
export async function cancelTwoFactorRecovery(req: Request | null, userId: string, how: CancelHow): Promise<boolean> {
  if (!(await repo.deleteRecovery(userId))) return false;
  const user = await repo.findUserById(userId);
  if (user) sendSecurityNotice(req, user.email, { kind: 'two_factor_recovery_cancelled', how });
  await audit({ action: 'auth.two_factor.recovery_cancelled', actor: how === 'link' ? { kind: 'link', purpose: 'two_factor_recovery_cancel' } : { kind: 'user', userId }, userId, detail: { how } });
  return true;
}

/** The cancel link from a recovery mail. */
export async function cancelTwoFactorRecoveryByLink(req: Request | null, tokenIn: unknown): Promise<void> {
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  const t = token ? await repo.takeToken(hashToken(token), 'two_factor_recovery_cancel', Date.now()) : null;
  if (!t || !(await cancelTwoFactorRecovery(req, t.userId, 'link'))) throw badRequest('This recovery has already ended or was cancelled.');
}

/**
 * The job: mails "completes soon" before a recovery is ready, then the link that finishes it once
 * it is. Claim-then-send, so each goes out once across instances; idempotent.
 */
export async function processTwoFactorRecoveries(now = Date.now()): Promise<{ reminded: number; ready: number }> {
  const delay = getConfig().twoFactorRecoveryDelayMs;
  const reminders = await repo.claimRecoveryReminders(now, Math.min(DAY, delay / 2), JOB_BATCH);
  for (const r of reminders) {
    const cancel = await insertLink(r.userId, 'two_factor_recovery_cancel', r.email, now, now + CANCEL_LINK_MS);
    sendSecurityNotice(
      null,
      r.email,
      { kind: 'two_factor_recovery_reminder', readyAt: r.readyAt, requestedFrom: r.requestedFrom, cancelUrl: appUrl(null, `/cancel-recovery?token=${cancel}`) },
      now,
    );
  }
  const ready = await repo.claimReadyRecoveries(now, JOB_BATCH);
  for (const r of ready) {
    await repo.deleteTokens(r.userId, 'two_factor_recovery');
    const finish = await insertLink(r.userId, 'two_factor_recovery', r.email, now, now + FINISH_LINK_DAYS * DAY);
    sendSecurityNotice(null, r.email, { kind: 'two_factor_recovery_ready', finishUrl: appUrl(null, `/recover-two-factor?token=${finish}`), validDays: FINISH_LINK_DAYS }, now);
  }
  return { reminded: reminders.length, ready: ready.length };
}

/** The link mailed when a recovery is ready: takes the account back with `password`. Returns the account. */
export async function finishTwoFactorRecovery(req: Request | null, tokenIn: unknown, passwordIn: unknown): Promise<Account> {
  const password = validatePassword(passwordIn); // before using the link up
  const token = typeof tokenIn === 'string' ? tokenIn : '';
  const now = Date.now();
  const t = token ? await repo.takeToken(hashToken(token), 'two_factor_recovery', now) : null;
  if (!t || !(await repo.finishTwoFactorRecovery(t.userId, t.email, await hashPassword(password), now))) throw invalidLink();
  await endSessionsOf(t.userId);
  await markEmailVerified(t.userId, t.email);
  sendSecurityNotice(req, t.email, { kind: 'two_factor_recovered' });
  await audit({ action: 'auth.two_factor.recovered', actor: { kind: 'link', purpose: 'two_factor_recovery' }, userId: t.userId });
  return getAccount(t.userId);
}

// ---- (c) operator reset (admin CLI) ----

export interface AccountSecuritySummary {
  id: string;
  email: string;
  emailVerified: boolean;
  createdAt: number;
  hasPassword: boolean;
  twoFactorEnabledAt: number | null;
  recoveryCodesLeft: number;
  identities: number;
  sessions: number;
  /** An email change's "this wasn't me" link to the previous address is still live: the address may not be the owner's. */
  pendingRevertEmail: boolean;
  recovery: { startedAt: number; readyAt: number } | null;
}

export async function accountSecuritySummary(emailIn: string): Promise<AccountSecuritySummary | null> {
  const user = await repo.findUserByEmail(normalizeEmail(emailIn));
  if (!user) return null;
  const s = await repo.securitySummary(user.id);
  const recovery = await repo.findRecovery(user.id);
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    hasPassword: user.passwordHash !== null,
    ...s,
    recovery: recovery && { startedAt: recovery.startedAt, readyAt: recovery.readyAt },
  };
}

/**
 * An operator removes two-step verification after checking who asked, out of band (see
 * docs/operations.md). The password and provider sign-ins go too — whoever locked the owner out
 * may know the password — so the owner picks a new password through the account's address.
 */
export async function resetTwoFactorByOperator(userId: string, operator: string, reason: string): Promise<void> {
  if (!(await repo.resetTwoFactorByOperator(userId))) throw new Error('No such account');
  const ended = await endSessionsOf(userId);
  const user = await repo.findUserById(userId);
  if (user) sendSecurityNotice(null, user.email, { kind: 'two_factor_reset_by_operator' });
  await audit({ action: 'auth.two_factor.reset_by_operator', actor: { kind: 'operator', name: operator }, userId, detail: { reason, sessionsEnded: ended } });
}
