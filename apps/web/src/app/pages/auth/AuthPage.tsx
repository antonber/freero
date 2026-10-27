import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlert, Eye, EyeOff, Lock, Mail, Sparkles, UserRound } from 'lucide-react';
import { Button, IconButton, Input, Logo } from '@ui';
import { useAuth } from '../../auth/AuthContext';
import { ApiError } from '../../api/client';
import { safeNext } from '../../lib/nav';
import './AuthPage.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO = { email: 'demo@freero.app', password: 'freero123' };

type Mode = 'login' | 'signup';
interface Errors { name?: string; email?: string; password?: string }

export function validateAuth(mode: Mode, v: { name: string; email: string; password: string }): Errors {
  const e: Errors = {};
  if (mode === 'signup') {
    if (!v.name.trim()) e.name = 'Tell us what to call you';
    else if (v.name.trim().length > 80) e.name = 'Keep it under 80 characters';
  }
  if (!v.email.trim()) e.email = 'Enter your email';
  else if (!EMAIL_RE.test(v.email.trim())) e.email = "That doesn't look like an email address";
  if (!v.password) e.password = 'Enter your password';
  else if (mode === 'signup' && v.password.length < 8) e.password = 'Use at least 8 characters';
  return e;
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { user, loading, login, signup } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const nextQuery = params.get('next') ? `?next=${encodeURIComponent(params.get('next')!)}` : '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setErrors({});
    setServerError(null);
    setTouched(false);
    document.title = mode === 'login' ? 'Log in · Freero' : 'Sign up · Freero';
    firstRef.current?.focus();
  }, [mode]);

  // Re-validate live after the first submit attempt.
  useEffect(() => {
    if (touched) setErrors(validateAuth(mode, { name, email, password }));
  }, [touched, mode, name, email, password]);

  if (!loading && user) return <Navigate to={next} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setTouched(true);
    const errs = validateAuth(mode, { name, email, password });
    setErrors(errs);
    setServerError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (mode === 'login') await login(email, password);
      else await signup(name, email, password);
      navigate(next, { replace: true });
    } catch (err) {
      setServerError(
        err instanceof ApiError
          ? err.status >= 500
            ? 'Freero is having trouble right now. Please try again in a moment.'
            : err.message
          : 'Could not reach Freero. Check your connection and try again.',
      );
      setBusy(false);
    }
  };

  const fillDemo = () => {
    setEmail(DEMO.email);
    setPassword(DEMO.password);
    setServerError(null);
  };

  const isLogin = mode === 'login';
  return (
    <div className="fr-authpage">
      <div className="fr-authpage__deco" aria-hidden>
        <span className="fr-authpage__sticky fr-authpage__sticky--a">plan the launch</span>
        <span className="fr-authpage__sticky fr-authpage__sticky--b">ideas welcome</span>
        <span className="fr-authpage__blob" />
      </div>
      <div className="fr-authcard">
        <Link to="/" className="fr-authcard__logo" aria-label="Freero home">
          <Logo size={36} />
        </Link>
        <h1 className="fr-authcard__title">{isLogin ? 'Welcome back' : 'Create your Freero account'}</h1>
        <p className="fr-authcard__sub">
          {isLogin ? 'Log in to pick up where your team left off.' : 'Free forever for your first boards. No card needed.'}
        </p>

        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          {!isLogin ? (
            <Input
              ref={firstRef}
              label="Name"
              icon={UserRound}
              size="lg"
              autoComplete="name"
              placeholder="Ada Lovelace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
            />
          ) : null}
          <Input
            ref={isLogin ? firstRef : undefined}
            label="Work email"
            icon={Mail}
            size="lg"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            error={errors.email}
          />
          <Input
            label="Password"
            icon={Lock}
            size="lg"
            type={showPw ? 'text' : 'password'}
            autoComplete={isLogin ? 'current-password' : 'new-password'}
            placeholder={isLogin ? 'Your password' : 'At least 8 characters'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            error={errors.password}
            suffix={
              <IconButton
                size={32}
                icon={showPw ? EyeOff : Eye}
                label={showPw ? 'Hide password' : 'Show password'}
                tooltip={false}
                onClick={() => setShowPw((s) => !s)}
              />
            }
          />

          {serverError ? (
            <div className="fr-authcard__error" role="alert">
              <CircleAlert size={16} aria-hidden />
              <span>{serverError}</span>
            </div>
          ) : null}

          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            {isLogin ? 'Log in' : 'Create account'}
          </Button>
        </form>

        {import.meta.env.DEV ? (
          <div className="fr-authcard__demo">
            <Sparkles size={16} aria-hidden />
            <span>
              Demo account: <code>{DEMO.email}</code> / <code>{DEMO.password}</code>
            </span>
            {isLogin ? (
              <button type="button" className="fr-authcard__demo-btn" onClick={fillDemo}>
                Fill in
              </button>
            ) : null}
          </div>
        ) : null}

        <p className="fr-authcard__switch">
          {isLogin ? (
            <>
              New to Freero? <Link to={`/signup${nextQuery}`}>Create an account</Link>
            </>
          ) : (
            <>
              Already have an account? <Link to={`/login${nextQuery}`}>Log in</Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
