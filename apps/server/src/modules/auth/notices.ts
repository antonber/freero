// Security notices: a short mail to the account's address whenever something that protects the
// account changes, or it is signed in to from a browser it hasn't seen before — so a hijacked
// session can't change these silently. They are account mail, not notifications: no opt-out.
//
// Each says what changed, when, from which device and roughly where (as the sessions list shows
// it), and what to do if it wasn't the owner. They never contain a password, code, secret or
// token; the only link carrying a token is the "this wasn't me" link of an email change, which
// goes to the previous address.
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
  | { kind: 'two_factor_on' }
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

const NOT_YOU = 'If this wasn’t you, someone else can get into your account. Reset your password now: that signs out every device. Then check your sign-in methods and two-step verification in Freero’s settings.';
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
          `${NOT_YOU} If the new second step keeps you out, ask whoever runs your Freero for help.`,
        ],
        action: reset,
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
