// "Resend link" for the email confirmation, wherever it is offered: the share dialog, the banner
// on the dashboard and Settings → Email. One wording for all three, so they don't drift:
//  - after a send, what to do while the mail is on its way (spam, a work address's quarantine);
//  - on the per-person limit (RATE_LIMIT_EMAIL_VERIFY, 429 `rate_limited`), that the links were
//    sent and only the newest works (each send replaces the last), with the time left, instead of
//    the generic "Too many requests". Clicking again and again is what people do when a mail filter
//    holds the message, so it must not read as a bug.
// The server doesn't tell the app MAIL_FROM, so the sender is named as Freero.
import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { t } from '../messages';

export interface ResendNotice {
  /** sent: the mail is on its way; limited: refused by the limit, earlier links were sent; failed: anything else. */
  kind: 'sent' | 'limited' | 'failed';
  text: string;
}

/** What to tell someone whose resend failed with `err`. */
export function resendFailure(err: unknown): ResendNotice {
  if (err instanceof ApiError && err.status === 429 && err.code === 'rate_limited') {
    const unit = err.params?.unit === 'minutes' || err.params?.unit === 'seconds' ? err.params.unit : 'later';
    const count = typeof err.params?.count === 'number' ? err.params.count : 0;
    return { kind: 'limited', text: t('verifyEmail.limited', { unit, count }) };
  }
  return { kind: 'failed', text: err instanceof ApiError ? err.message : t('couldNotSendTheLink') };
}

/** Sends the confirmation link again; `notice` says how it went, in the place that offered it. */
export function useVerificationResend(email: string) {
  const [notice, setNotice] = useState<ResendNotice | null>(null);
  const [busy, setBusy] = useState(false);
  const resend = async () => {
    setBusy(true);
    try {
      await api.resendVerification();
      setNotice({ kind: 'sent', text: t('verifyEmail.sent', { email }) });
    } catch (err) {
      setNotice(resendFailure(err));
    } finally {
      setBusy(false);
    }
  };
  return { notice, busy, resend };
}
