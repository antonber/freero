// Security notices: a short mail to the account's address whenever something that protects the
// account changes, or it is signed in to from a browser it hasn't seen before — so a hijacked
// session can't change these silently. They are account mail, not notifications: no opt-out.
//
// Each says what changed, when, from which device and roughly where (as the sessions list shows
// it), and what to do if it wasn't the owner. They never contain a password, code, secret or
// token. The only links carrying a token act for whoever reads the VERIFIED address they went to:
// "this wasn't me" after an email change (to the previous address) and after two-step
// verification was turned on, and the cancel / finish links of a two-step recovery (KAI-99).
import type { Request } from 'express';
import { describeDevice } from '@freero/shared';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { clientIp } from '../../platform/rateLimit';
import { locateIp, maskIp } from './geoip';

export type SecurityNotice =
  | { kind: 'password_changed' }
  /** A first password on an account that signed in only through providers so far. */
  | { kind: 'password_set' }
  | { kind: 'password_reset' }
  /** To the PREVIOUS address. `revertUrl`: the single-use "this wasn't me" link. */
  | { kind: 'email_changed'; newEmail: string; revertUrl: string; validDays: number }
  /** `undoUrl`: the single-use "this wasn't me" link (only to a verified address), valid `validHours`. */
  | { kind: 'two_factor_on'; undoUrl: string | null; validHours: number }
  /** Removed with the "this wasn't me" link of the two-step-on notice. */
  | { kind: 'two_factor_undone' }
  /** A "lost my authenticator" recovery started; it can be finished from `readyAt` on. */
  | { kind: 'two_factor_recovery_started'; readyAt: number; cancelUrl: string }
  | { kind: 'two_factor_recovery_reminder'; readyAt: number; requestedFrom: string; cancelUrl: string }
  /** The recovery's waiting period is over: `finishUrl` removes two-step verification. */
  | { kind: 'two_factor_recovery_ready'; finishUrl: string; validDays: number }
  /** `how`: someone passed the second step, cancelled it while signed in, or used the cancel link. */
  | { kind: 'two_factor_recovery_cancelled'; how: 'second_step' | 'signed_in' | 'link' }
  | { kind: 'two_factor_recovered' }
  /** An operator reset two-step verification after checking who asked (admin CLI). */
  | { kind: 'two_factor_reset_by_operator' }
  | { kind: 'two_factor_off' }
  | { kind: 'recovery_codes' }
  | { kind: 'provider_connected'; provider: string; providerEmail: string | null }
  | { kind: 'provider_disconnected'; provider: string }
  /** `method`: how it signed in ('password', or a provider's label). */
  | { kind: 'new_sign_in'; method: string }
  | { kind: 'deletion_scheduled'; at: number };

/** "Wed, 28 Oct 2026 17:03 UTC" */
const when = (ms: number) => new Date(ms).toUTCString().replace(/:\d\d GMT$/, ' UTC');

/** "j***@example.com": enough to recognise an address, not to learn someone else's. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  return at < 1 ? '***' : `${email[0]}***${email.slice(at)}`;
}

/** "When: … · Device: Chrome on Windows · Where: Lyon, France" for the request that made the change. */
function circumstances(req: Request | null, now: number): string {
  const parts = [`When: ${when(now)}`];
  if (req) {
    parts.push(`Device: ${describeDevice(req.get('user-agent') ?? '')}`);
    const ip = clientIp(req);
    const where = locateIp(ip) ?? maskIp(ip);
    if (where) parts.push(where === 'This computer' ? 'Where: the server’s own machine' : `Where: ${where} (approximate)`);
  }
  return parts.join(' · ');
}

/** "Chrome on Windows in Lyon, France (approximate)": where a request came from, for a later mail. */
export function requestOrigin(req: Request): string {
  const ip = clientIp(req);
  const where = locateIp(ip) ?? maskIp(ip);
  const device = describeDevice(req.get('user-agent') ?? '');
  if (!where) return device;
  return where === 'This computer' ? `${device} on the server’s own machine` : `${device} in ${where} (approximate)`;
}

const NOT_YOU ='If this wasn’t you, someone else can get into your account. Reset your password now: that signs out every device. Then check your sign-in methods and two-step verification in Freero’s settings.';
const OUTRO = 'Freero sends this notice for every change to how your account is protected. It can’t be turned off.';

/** Mails a security notice to `to` (the account's address — the previous one for email_changed). Never throws. */
export function sendSecurityNotice(req: Request | null, to: string, notice: SecurityNotice, now = Date.now()): void {
  const reset = { label: 'Reset your password', url: appUrl(req, `/forgot-password?email=${encodeURIComponent(to)}`) };
  const at = circumstances(req, now);
  let m: { subject: string; title: string; paragraphs: string[]; action?: { label: string; url: string } };
  switch (notice.kind) {
    case 'password_changed':
      m = {
        subject: 'Your Freero password was changed',
        title: 'Your password was changed',
        paragraphs: [`The password of your Freero account (${to}) was changed, and every other device was signed out.`, at, NOT_YOU],
        action: reset,
      };
      break;
    case 'password_set':
      m = {
        subject: 'A password was added to your Freero account',
        title: 'Your account has a password now',
        paragraphs: [`Your Freero account (${to}) can now be signed in to with this email address and a password, as well as with its sign-in providers.`, at, NOT_YOU],
        action: reset,
      };
      break;
    case 'password_reset':
      m = {
        subject: 'Your Freero password was reset',
        title: 'Your password was reset',
        paragraphs: [
          `The password of your Freero account (${to}) was reset with a link sent to this address, and every device was signed out.`,
          at,
          'If this wasn’t you, someone can read your email. Secure your email account first (change its password), then reset your Freero password again.',
        ],
        action: reset,
      };
      break;
    case 'email_changed':
      m = {
        subject: 'Your Freero email address was changed',
        title: 'Your email address was changed',
        paragraphs: [
          `Your Freero account now uses ${maskEmail(notice.newEmail)} instead of this address. Mail about the account goes there from now on.`,
          at,
          `If this wasn’t you, use the button below within ${notice.validDays} days. It moves your account back to this address, signs out every device, undoes two-step verification and sign-in providers set up since the change, and lets you choose a new password. The link works once.`,
        ],
        action: { label: 'This wasn’t me: restore my address', url: notice.revertUrl },
      };
      break;
    case 'two_factor_on':
      m = {
        subject: 'Two-step verification is on for your Freero account',
        title: 'Two-step verification was turned on',
        paragraphs: [
          'Signing in to your Freero account now also takes a code from an authenticator app (or a recovery code). Every other device was signed out.',
          at,
          notice.undoUrl
            ? `If this wasn’t you, someone knows your password and has locked the account with their own authenticator. Use the button below within ${notice.validHours} hours: it removes that authenticator and every connected sign-in provider, signs out every device, and lets you choose a new password. The link works once.`
            : `${NOT_YOU} If the new second step keeps you out, choose “Can’t use your app?” and then “Lost your recovery codes too?” when Freero asks for the code.`,
        ],
        action: notice.undoUrl ? { label: 'This wasn’t me: remove it', url: notice.undoUrl } : reset,
      };
      break;
    case 'two_factor_undone':
      m = {
        subject: 'Two-step verification was removed from your Freero account',
        title: 'Two-step verification was removed',
        paragraphs: [
          'The “this wasn’t me” link from the two-step verification notice was used: the authenticator and every connected sign-in provider were removed, a new password was chosen and every device was signed out.',
          at,
          'If this wasn’t you, someone can read your email. Secure your email account first (change its password), then reset your Freero password and turn on two-step verification again.',
        ],
        action: reset,
      };
      break;
    case 'two_factor_recovery_started':
      m = {
        subject: 'Account recovery started for your Freero account',
        title: 'Two-step verification recovery started',
        paragraphs: [
          `Someone signed in with your password (or a connected sign-in provider) and said they lost their authenticator. On ${when(notice.readyAt)}, Freero will email this address a link that removes two-step verification. Until then nothing changes.`,
          at,
          'If this wasn’t you, cancel it with the button below, or sign in with your authenticator (that cancels it too). Then change your password: whoever started this knows it.',
        ],
        action: { label: 'Cancel the recovery', url: notice.cancelUrl },
      };
      break;
    case 'two_factor_recovery_reminder':
      m = {
        subject: 'Two-step verification will be removable soon',
        title: 'Account recovery completes soon',
        paragraphs: [
          `A recovery of your Freero account was started from ${notice.requestedFrom}. On ${when(notice.readyAt)}, Freero will email this address a link that removes two-step verification.`,
          'If this wasn’t you, cancel it now with the button below, or sign in with your authenticator (that cancels it too). Then change your password.',
        ],
        action: { label: 'Cancel the recovery', url: notice.cancelUrl },
      };
      break;
    case 'two_factor_recovery_ready':
      m = {
        subject: 'Finish recovering your Freero account',
        title: 'Your account recovery is ready',
        paragraphs: [
          `The waiting period of your account recovery is over. Use the button below within ${notice.validDays} days to remove two-step verification and every connected sign-in provider, sign out every device and choose a new password. The link works once.`,
          'If you didn’t start this, don’t use the link: sign in with your authenticator instead (that cancels the recovery), then change your password.',
        ],
        action: { label: 'Finish the recovery', url: notice.finishUrl },
      };
      break;
    case 'two_factor_recovery_cancelled':
      m = {
        subject: 'Account recovery cancelled for your Freero account',
        title: 'Account recovery was cancelled',
        paragraphs: [
          notice.how === 'second_step'
            ? 'Someone passed two-step verification on your Freero account, so the recovery that would have removed it was cancelled: the authenticator isn’t lost.'
            : notice.how === 'signed_in'
              ? 'The recovery that would have removed two-step verification from your Freero account was cancelled from a signed-in device.'
              : 'The recovery that would have removed two-step verification from your Freero account was cancelled with the link from the recovery email.',
          at,
          'If you started the recovery because someone else’s authenticator locks you out, ask whoever runs your Freero to check who you are and reset it.',
        ],
      };
      break;
    case 'two_factor_recovered':
      m = {
        subject: 'Two-step verification was removed from your Freero account',
        title: 'Account recovery completed',
        paragraphs: [
          'After the waiting period, two-step verification and every connected sign-in provider were removed from your Freero account with the link sent to this address. A new password was chosen and every device was signed out.',
          at,
          'If this wasn’t you, someone knows your password and can read your email. Secure your email account first, then reset your Freero password.',
        ],
        action: reset,
      };
      break;
    case 'two_factor_reset_by_operator':
      m = {
        subject: 'Two-step verification was reset on your Freero account',
        title: 'Two-step verification was reset for you',
        paragraphs: [
          'After checking who you are, whoever runs your Freero removed two-step verification, every connected sign-in provider and the password from your account, and signed out every device.',
          at,
          'Choose a new password with the button below (the link goes to this address), then turn two-step verification on again in settings. If you didn’t ask for this, reply to whoever runs your Freero right away.',
        ],
        action: { label: 'Choose a new password', url: reset.url },
      };
      break;
    case 'two_factor_off':
      m = {
        subject: 'Two-step verification is off for your Freero account',
        title: 'Two-step verification was turned off',
        paragraphs: ['Signing in to your Freero account no longer asks for a code from an authenticator app, and its recovery codes stopped working.', at, NOT_YOU],
        action: reset,
      };
      break;
    case 'recovery_codes':
      m = {
        subject: 'New recovery codes for your Freero account',
        title: 'New recovery codes were created',
        paragraphs: [
          'New two-step verification recovery codes were created for your Freero account, and the previous ones stopped working. Freero shows recovery codes only once, on screen; they are never sent by email.',
          at,
          NOT_YOU,
        ],
        action: reset,
      };
      break;
    case 'provider_connected':
      m = {
        subject: `${notice.provider} sign-in was connected to your Freero account`,
        title: `${notice.provider} sign-in was connected`,
        paragraphs: [
          `Your Freero account can now be signed in to with the ${notice.provider} account${notice.providerEmail ? ` ${notice.providerEmail}` : ''}.`,
          at,
          `${NOT_YOU} Disconnect ${notice.provider} there too.`,
        ],
        action: reset,
      };
      break;
    case 'provider_disconnected':
      m = {
        subject: `${notice.provider} sign-in was disconnected from your Freero account`,
        title: `${notice.provider} sign-in was disconnected`,
        paragraphs: [`Your Freero account can no longer be signed in to with ${notice.provider}.`, at, NOT_YOU],
        action: reset,
      };
      break;
    case 'new_sign_in':
      m = {
        subject: 'New sign-in to your Freero account',
        title: 'New sign-in from another browser',
        paragraphs: [
          `Your Freero account was signed in to ${notice.method === 'password' ? 'with its password' : `with ${notice.method}`} from a browser that hasn’t signed in to it before. If that was you, there is nothing to do.`,
          at,
          NOT_YOU,
        ],
        action: reset,
      };
      break;
    case 'deletion_scheduled':
      m = {
        subject: 'Your Freero account will be deleted',
        title: 'Your account is scheduled for deletion',
        paragraphs: [
          `Your Freero account and the boards you own will be deleted for good on ${when(notice.at).replace(/ \d\d:\d\d UTC$/, '')}. Every device was signed out.`,
          at,
          'Changed your mind, or it wasn’t you? Log in before then and choose “Restore account”. If it wasn’t you, change your password right after.',
        ],
        action: { label: 'Log in to restore', url: appUrl(req, '/login') },
      };
      break;
  }
  sendMailLater({ to, ...renderMail({ ...m, outro: OUTRO }) });
}
