import { MailWarning } from 'lucide-react';
import { Button } from '@ui';
import { useAuth } from '../auth/AuthContext';
import { useVerificationResend } from '../auth/verificationResend';
import { t } from '../messages';
import '../pages/account/account.css';

/** "Confirm your email" until the account's address is verified (inviting and sharing need it). */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const { notice, busy, resend } = useVerificationResend(user?.email ?? '');
  if (!user || user.emailVerified) return null;

  return (
    <div className="fr-acct-verify" role="status">
      <MailWarning size={18} aria-hidden />
      <span>{notice ? notice.text : t('confirmYourEmailAddressEmail', { email: user.email })}</span>
      {/* Sent, or refused because links were sent already: another click wouldn't help. */}
      {notice && notice.kind !== 'failed' ? null : (
        <Button size="sm" variant="secondary" onClick={resend} disabled={busy}>{t('resendLink')}</Button>
      )}
    </div>
  );
}
