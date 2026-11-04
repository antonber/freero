import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { Button, Input } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from './AuthShell';

import { t } from './messages';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.status >= 500 ? fallback : err.message) : t('couldNotReachFreeroCheck');

/** /forgot-password — asks for a reset link. The answer is the same whether or not the account exists. */
export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError(t('thatDoesnTLookLike'));
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(message(err, t('couldNotSendTheLink')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell docTitle={t('resetPassword')} title={t('forgotYourPassword')} sub={t('weLlEmailYouA')}>
      {sent ? (
        <AuthNotice kind="success">{t('ifAnAccountUses')}{' '}<strong>{email.trim()}</strong>{t('aResetLinkIsOn')}</AuthNotice>
      ) : (
        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          <Input
            label={t('email')}
            icon={Mail}
            size="lg"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={error ?? undefined}
          />
          <Button type="submit" variant="primary" size="lg" block loading={busy}>{t('sendResetLink')}</Button>
        </form>
      )}
      <p className="fr-authcard__switch">{t('rememberedIt')}{' '}<Link to="/login">{t('backToLogIn')}</Link>
      </p>
    </AuthShell>
  );
}

type LinkMode = 'reset' | 'revert' | 'undo' | 'recover';

const LINK_COPY: Record<LinkMode, { doc: string; title: string; sub: string; submit: string; failed: string }> = {
  reset: {
    doc: t('chooseANewPassword'),
    title: t('chooseANewPassword'),
    sub: t('youLlBeSignedOut'),
    submit: t('savePasswordAndLogIn'),
    failed: t('couldNotResetThePassword'),
  },
  revert: {
    doc: t('restoreYourEmailAddress'),
    title: t('takeYourAccountBack'),
    sub: t('yourAccountMovesBackTo'),
    submit: t('restoreMyAccountAndLog'),
    failed: t('couldNotRestoreYourAddress'),
  },
  undo: {
    doc: t('removeTwoStepVerification'),
    title: t('takeYourAccountBack'),
    sub: t('theAuthenticatorThatWasJust'),
    submit: t('removeItAndLogIn'),
    failed: t('couldNotTakeTheAccount'),
  },
  recover: {
    doc: t('finishAccountRecovery'),
    title: t('finishRecoveringYourAccount'),
    sub: t('twoStepVerificationAndEvery'),
    submit: t('finishAndLogIn'),
    failed: t('couldNotFinishTheRecovery'),
  },
};

/**
 * Pages of emailed single-use links that end with a new password:
 * /reset-password?token= — sets the new password; every other session of the account ends.
 * /revert-email?token= (mode "revert") — "this wasn't me" from the email-change notice sent to the
 * previous address: the account moves back to it and gets a new password.
 * /undo-two-factor?token= (mode "undo") — "this wasn't me" from the two-step-on notice.
 * /recover-two-factor?token= (mode "recover") — finishes a two-step recovery after its waiting period.
 */
export function ResetPasswordPage({ mode = 'reset' }: { mode?: LinkMode }) {
  const revert = mode === 'revert';
  const copy = LINK_COPY[mode];
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { adopt } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return setError(t('useAtLeast8Characters'));
    if (password !== confirm) return setError(t('thePasswordsDonTMatch'));
    setBusy(true);
    setError(null);
    try {
      const res =
        mode === 'revert'
          ? await api.revertEmailChange(token, password)
          : mode === 'undo'
            ? await api.undoTwoFactor(token, password)
            : mode === 'recover'
              ? await api.finishTwoFactorRecovery(token, password)
              : await api.resetPassword(token, password);
      if ('user' in res) {
        adopt(res.user);
        navigate('/app', { replace: true });
      } else {
        // Two-factor on: the link proved the address, not the second step.
        navigate('/login/two-factor', { replace: true });
      }
    } catch (err) {
      setError(message(err, copy.failed));
      setBusy(false);
    }
  };

  return (
    <AuthShell docTitle={copy.doc} title={copy.title} sub={copy.sub}>
      {!token ? (
        <AuthNotice kind="error">{t('thisLinkIsIncompleteOpen')}</AuthNotice>
      ) : (
        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          <Input
            label={t('newPassword')}
            icon={Lock}
            size="lg"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder={t('atLeast8Characters')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label={t('repeatIt')}
            icon={Lock}
            size="lg"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {copy.submit}
          </Button>
        </form>
      )}
      <p className="fr-authcard__switch">
        {revert ? (
          // A reset link would go to the address that replaced this one.
          <>{t('linkExpiredOrAlreadyUsed')}</>
        ) : mode !== 'reset' ? (
          <>{t('linkExpiredOrAlreadyUsed2')}</>
        ) : (
          <>{t('linkExpired')}{' '}<Link to="/forgot-password">{t('sendANewOne')}</Link>
          </>
        )}
      </p>
    </AuthShell>
  );
}
