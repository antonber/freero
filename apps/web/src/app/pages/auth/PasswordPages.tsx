import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Mail } from 'lucide-react';
import { Button, Input } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { AuthNotice, AuthShell } from './AuthShell';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const message = (err: unknown, fallback: string) =>
  err instanceof ApiError ? (err.status >= 500 ? fallback : err.message) : 'Could not reach Freero. Check your connection and try again.';

/** /forgot-password — asks for a reset link. The answer is the same whether or not the account exists. */
export function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError("That doesn't look like an email address");
    setBusy(true);
    setError(null);
    try {
      await api.forgotPassword(email.trim());
      setSent(true);
    } catch (err) {
      setError(message(err, 'Could not send the link. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell docTitle="Reset password" title="Forgot your password?" sub="We'll email you a link to choose a new one.">
      {sent ? (
        <AuthNotice kind="success">
          If an account uses <strong>{email.trim()}</strong>, a reset link is on its way. It works for 30 minutes.
        </AuthNotice>
      ) : (
        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          <Input
            label="Email"
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
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="fr-authcard__switch">
        Remembered it? <Link to="/login">Back to log in</Link>
      </p>
    </AuthShell>
  );
}

/** /reset-password?token= — sets the new password; every other session of the account ends. */
export function ResetPasswordPage() {
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
    if (password.length < 8) return setError('Use at least 8 characters');
    if (password !== confirm) return setError('The passwords don’t match');
    setBusy(true);
    setError(null);
    try {
      const res = await api.resetPassword(token, password);
      if ('user' in res) {
        adopt(res.user);
        navigate('/app', { replace: true });
      } else {
        // Two-factor on: the link proved the address, not the second step.
        navigate('/login/two-factor', { replace: true });
      }
    } catch (err) {
      setError(message(err, 'Could not reset the password. Please try again.'));
      setBusy(false);
    }
  };

  return (
    <AuthShell docTitle="Choose a new password" title="Choose a new password" sub="You'll be signed out on every other device.">
      {!token ? (
        <AuthNotice kind="error">This link is incomplete. Open the link from the email again.</AuthNotice>
      ) : (
        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          <Input
            label="New password"
            icon={Lock}
            size="lg"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <Input
            label="Repeat it"
            icon={Lock}
            size="lg"
            type="password"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {error ? <AuthNotice kind="error">{error}</AuthNotice> : null}
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Save password and log in
          </Button>
        </form>
      )}
      <p className="fr-authcard__switch">
        Link expired? <Link to="/forgot-password">Send a new one</Link>
      </p>
    </AuthShell>
  );
}
