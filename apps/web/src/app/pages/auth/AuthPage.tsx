import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlert, Eye, EyeOff, KeyRound, Lock, Mail, Sparkles, UserRound } from 'lucide-react';
import { SSO_REQUIRED, type SsoDiscovery } from '@freero/shared';
import { Button, IconButton, Input, Logo } from '@ui';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError } from '../../api/client';
import { safeNext } from '../../lib/nav';
import { ProviderButtons, providerErrorText } from './ProviderButtons';
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
  const carried = new URLSearchParams();
  for (const k of ['next', 'email']) if (params.get(k)) carried.set(k, params.get(k)!);
  const nextQuery = carried.toString() ? `?${carried}` : '';

  const [name, setName] = useState('');
  const [email, setEmail] = useState(params.get('email') ?? ''); // invite links prefill it
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // A provider sign-in that came back with ?error= (until the next attempt).
  const [providerError, setProviderError] = useState<string | null>(() => providerErrorText(params.get('error')));
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  // Single sign-on for the address's domain (looked up by domain only, as the address is typed).
  const [sso, setSso] = useState<SsoDiscovery['sso']>(null);
  const [breakGlass, setBreakGlass] = useState(false);
  useEffect(() => {
    const e = email.trim();
    if (!EMAIL_RE.test(e)) {
      setSso(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.discoverSso(e, next).then(
        (r) => live && setSso(r.sso),
        () => live && setSso(null),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [email, next]);
  // Enforced: the password form is only for the workspace's break-glass owner.
  const ssoOnly = !!sso?.enforced && !breakGlass;

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
    setProviderError(null);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      if (mode === 'login') {
        if (!(await login(email, password))) {
          // Two-factor on: the password was right; the second step finishes the sign-in.
          navigate(`/login/two-factor?next=${encodeURIComponent(next)}`, { replace: true });
          return;
        }
      } else await signup(name, email, password);
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === SSO_REQUIRED) {
        // The organization signs this address in through its identity provider.
        setBreakGlass(false);
        api.discoverSso(email.trim(), next).then((r) => setSso(r.sso), () => undefined);
      }
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
  // Arrived from a board link (or an invite) while signed out.
  const toBoard = next.startsWith('/board/') || next.startsWith('/invite/') || next.startsWith('/workspace-invite/');
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
          {toBoard
            ? isLogin
              ? 'Log in to open the board that was shared with you.'
              : 'Create a free account to open the board that was shared with you.'
            : isLogin
              ? 'Log in to pick up where your team left off.'
              : 'Free forever for your first boards. No card needed.'}
        </p>

        <ProviderButtons next={next} verb={isLogin ? 'Continue' : 'Sign up'} />

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
          {sso ? (
            <div className="fr-authcard__sso" data-testid="sso-route">
              <span>
                <strong>{sso.workspaceName}</strong> {sso.enforced ? 'signs you in with single sign-on.' : 'uses single sign-on.'}
              </span>
              <a className="fr-authcard__sso-btn" href={sso.startUrl}>
                <KeyRound size={16} aria-hidden /> Continue with SSO
              </a>
              {sso.enforced && isLogin ? (
                <button type="button" className="fr-authcard__sso-alt" onClick={() => setBreakGlass((b) => !b)}>
                  {breakGlass ? 'Hide password sign-in' : 'Workspace owner? Sign in with your password'}
                </button>
              ) : null}
            </div>
          ) : null}
          {ssoOnly ? null : (
            <>
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

              {isLogin ? (
                <Link className="fr-authcard__forgot" to={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}>
                  Forgot password?
                </Link>
              ) : null}
            </>
          )}

          {serverError || providerError ? (
            <div className="fr-authcard__error" role="alert">
              <CircleAlert size={16} aria-hidden />
              <span>{serverError ?? providerError}</span>
            </div>
          ) : null}

          {ssoOnly ? null : (
            <Button type="submit" variant={sso ? 'secondary' : 'primary'} size="lg" block loading={busy}>
              {isLogin ? 'Log in' : 'Create account'}
            </Button>
          )}
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
