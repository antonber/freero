import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { KeyRound, ShieldCheck } from 'lucide-react';
import { Button, Input } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { loginPath, safeNext } from '../../lib/nav';
import { AuthNotice, AuthShell } from './AuthShell';

import { t } from './messages';
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
  const [lost, setLost] = useState(false);

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const value = code.trim();
    if (!value) return setError(recovery ? t('enterOneOfYourRecovery') : t('enterThe6DigitCode'));
    setBusy(true);
    setError(null);
    try {
      await completeTwoFactor(value);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setExpired(true);
      setError(
        err instanceof ApiError && err.status < 500 ? err.message : t('couldNotReachFreeroCheck'),
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

  if (lost) return <LostAuthenticator onBack={() => setLost(false)} onExpired={() => navigate(loginPath(next), { replace: true })} />;

  return (
    <AuthShell
      docTitle={t('twoStepVerification')}
      title={t('twoStepVerification')}
      sub={
        recovery
          ? t('enterOneOfTheRecovery')
          : t('openYourAuthenticatorAppAnd')
      }
    >
      {expired ? (
        <>
          <AuthNotice kind="error">{error}</AuthNotice>
          <div className="fr-authcard__actions">
            <Button variant="primary" size="lg" block onClick={() => navigate(loginPath(next), { replace: true })}>{t('logInAgain')}</Button>
          </div>
        </>
      ) : (
        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          <Input
            key={recovery ? 'recovery' : 'totp'}
            label={recovery ? t('recoveryCode') : t('authenticationCode')}
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
          <Button type="submit" variant="primary" size="lg" block loading={busy}>{t('verifyAndLogIn')}</Button>
          <button type="button" className="fr-authcard__linkbtn" onClick={switchMode}>
            {recovery ? t('useTheAuthenticatorAppInstead') : t('canTUseYourApp')}
          </button>
          {recovery ? (
            <button type="button" className="fr-authcard__linkbtn" onClick={() => setLost(true)}>{t('lostYourRecoveryCodesToo')}</button>
          ) : null}
        </form>
      )}
      <p className="fr-authcard__switch">{t('notYou')}{' '}<Link to="/login">{t('backToLogIn')}</Link>
      </p>
    </AuthShell>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

/**
 * "Lost access to your authenticator?" — starts the delayed recovery (server: auth/recovery.ts)
 * from the pending sign-in. Nothing changes until the waiting period is over; the owner is mailed
 * at the start, before the end and when it is ready, and their authenticator cancels it.
 */
function LostAuthenticator({ onBack, onExpired }: { onBack: () => void; onExpired: () => void }) {
  const [readyAt, setReadyAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setReadyAt((await api.startTwoFactorRecovery()).readyAt);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setExpired(true);
      setError(err instanceof ApiError && err.status < 500 ? err.message : t('couldNotReachFreeroCheck'));
    } finally {
      setBusy(false);
    }
  };

  if (readyAt !== null)
    return (
      <AuthShell docTitle={t('accountRecovery')} title={t('recoveryStarted')}>
        <AuthNotice kind="success">{t('weEmailedYourAccountS')}{' '}<strong>{dateFormat.format(readyAt)}</strong>{' '}{t('weLlEmailItA')}</AuthNotice>
        <p className="fr-authcard__switch">{t('foundYourAuthenticatorMeanwhileLog')}{' '}<Link to="/login">{t('backToLogIn')}</Link>
        </p>
      </AuthShell>
    );

  return (
    <AuthShell
      docTitle={t('accountRecovery')}
      title={t('lostAccessToYourAuthenticator')}
      sub={t('withoutYourAuthenticatorAppOr')}
    >
      <div className="fr-authcard__form">
        <p className="fr-authcard__sub">{t('weEmailYourAccountS')}</p>
        {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
        {expired ? (
          <Button variant="primary" size="lg" block onClick={onExpired}>{t('logInAgain')}</Button>
        ) : (
          <Button variant="primary" size="lg" block loading={busy} onClick={start}>{t('startAccountRecovery')}</Button>
        )}
        <button type="button" className="fr-authcard__linkbtn" onClick={onBack}>{t('iHaveACodeAfter')}</button>
      </div>
    </AuthShell>
  );
}
