import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { Button, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { t } from '../messages';
import '../pages/account/account.css';

/** "Confirm your email" until the account's address is verified (inviting and sharing need it). */
export function VerifyEmailBanner() {
  const { user } = useAuth();
  const notify = useToast();
  const [sent, setSent] = useState(false);
  if (!user || user.emailVerified) return null;

  const resend = async () => {
    try {
      await api.resendVerification();
      setSent(true);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : t('couldNotSendTheLink'), 'error');
    }
  };

  return (
    <div className="fr-acct-verify" role="status">
      <MailWarning size={18} aria-hidden />
      <span>
        {sent
          ? t('sentOpenTheLinkWe', { email: user.email })
          : t('confirmYourEmailAddressEmail', { email: user.email })}
      </span>
      {sent ? null : (
        <Button size="sm" variant="secondary" onClick={resend}>{t('resendLink')}</Button>
      )}
    </div>
  );
}
