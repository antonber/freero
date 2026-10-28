import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button, Input } from '@ui';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { loginPath, safeNext } from '../../lib/nav';
import { AuthNotice, AuthShell } from './AuthShell';

/**
 * /login/two-factor?next= — the second step of a sign-in (password, reset link or provider) for an
 * account with two-step verification on. The pending sign-in is an HttpOnly cookie the server set.
 */
export function TwoFactorPage() {
  const { user, loading, completeTwoFactor } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const [recovery, setRecovery] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return setError(recovery ? 'Enter one of your recovery codes' : 'Enter the 6-digit code');
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(value);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setExpired(true);
      setError(
        err instanceof ApiError && err.status < 500 ? err.message : 'Could not reach Freero. Check your connection and try again.',
      );
      setCode('');
      setBusy(false);
    }
  };

  const switchMode = () => {
    setRecovery((r) => !r);
    setCode('');
    setError(null);
  };

  return (
    <AuthShell
      docTitle="Two-step verification"
      title="Two-step verification"
      sub={
        recovery
          ? 'Enter one of the recovery codes you saved when you turned on two-step verification. Each code works once.'
          : 'Open your authenticator app and enter the 6-digit code for Freero.'
      }
    >
      {expired ? (
        <>
          <AuthNotice kind="error">{error}</AuthNotice>
          <div className="fr-authcard__actions">
            <Button variant="primary" size="lg" block onClick={() => navigate(loginPath(next), { replace: true })}>
              Log in again
            </Button>
          </div>
        </>
      ) : (
        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          <Input
            key={recovery ? 'recovery' : 'totp'}
            label={recovery ? 'Recovery code' : 'Authentication code'}
            icon={recovery ? KeyRound : ShieldCheck}
            size="lg"
            autoFocus
            autoComplete="one-time-code"
            inputMode={recovery ? 'text' : 'numeric'}
            maxLength={recovery ? 20 : 6}
            placeholder={recovery ? 'xxxxx-xxxxx' : '123456'}
            value={code}
            onChange={(e) => setCode(recovery ? e.target.value : e.target.value.replace(/\D/g, ''))}
          />
          {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Verify and log in
          </Button>
          <button type="button" className="fr-authcard__linkbtn" onClick={switchMode}>
            {recovery ? 'Use the authenticator app instead' : 'Can’t use your app? Use a recovery code'}
          </button>
        </form>
      )}
      <p className="fr-authcard__switch">
        Not you? <Link to="/login">Back to log in</Link>
      </p>
    </AuthShell>
  );
}
