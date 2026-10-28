import { useState } from 'react';
import { MailWarning } from 'lucide-react';
import { Button, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
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
      notify(err instanceof ApiError ? err.message : 'Could not send the link', 'error');
    }
  };

  return (
    <div className="fr-acct-verify" role="status">
      <MailWarning size={18} aria-hidden />
      <span>
        {sent
          ? `Sent! Open the link we emailed to ${user.email}.`
          : `Confirm your email address (${user.email}) to invite people and share boards.`}
      </span>
      {sent ? null : (
        <Button size="sm" variant="secondary" onClick={resend}>
          Resend link
        </Button>
      )}
    </div>
  );
}
