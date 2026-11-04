import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from '../auth/AuthShell';

import { t } from './messages';
/**
 * Shown instead of any signed-in page while the account is in its deletion grace period: the
 * server refuses everything else until it is restored.
 */
export function RestoreAccountPage() {
  const { user, adopt, logout } = useAuth();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user?.deletionScheduledFor) return null;
  const day = new Date(user.deletionScheduledFor).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  const restore = async () => {
    setBusy(true);
    try {
      adopt((await api.restoreAccount()).user);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('couldNotReachFreeroTry'));
      setBusy(false);
    }
  };

  return (
    <AuthShell
      docTitle={t('restoreAccount')}
      title={t('yourAccountIsScheduledFor')}
      sub={t('emailAndTheBoardsIt', { email: user.email, day })}
    >
      {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
      <div className="fr-authcard__actions">
        <Button variant="primary" size="lg" block loading={busy} onClick={restore}>{t('restoreMyAccount')}</Button>
        <Button
          size="lg"
          block
          onClick={async () => {
            await logout();
            navigate('/', { replace: true });
          }}
        >{t('keepItDeletedAndLog')}</Button>
      </div>
    </AuthShell>
  );
}
