import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from '../auth/AuthShell';

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
      setError(err instanceof ApiError ? err.message : 'Could not reach Freero. Try again.');
      setBusy(false);
    }
  };

  return (
    <AuthShell
      docTitle="Restore account"
      title="Your account is scheduled for deletion"
      sub={`${user.email} and the boards it owns will be deleted for good on ${day}.`}
    >
      {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
      <div className="fr-authcard__actions">
        <Button variant="primary" size="lg" block loading={busy} onClick={restore}>
          Restore my account
        </Button>
        <Button
          size="lg"
          block
          onClick={async () => {
            await logout();
            navigate('/', { replace: true });
          }}
        >
          Keep it deleted and log out
        </Button>
      </div>
    </AuthShell>
  );
}
