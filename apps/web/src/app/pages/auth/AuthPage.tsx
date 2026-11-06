import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { CircleAlert, Eye, EyeOff, KeyRound, Lock, Mail, Sparkles, UserRound } from 'lucide-react';
import { SSO_REQUIRED, type DiscoverySource, type SiteLegal, type SsoDiscovery } from '@freero/shared';
import { Button, IconButton, Input, Logo, Select, type SelectOption } from '@ui';
import { noteProviderSignIn } from '../../analytics/bridge';
import { useAuth } from '../../auth/AuthContext';
import { api, ApiError } from '../../api/client';
import { safeNext } from '../../lib/nav';
import { ProviderButtons, providerErrorText } from './ProviderButtons';
import { t as tr } from './messages';
import './AuthPage.css';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DEMO = { email: 'demo@freero.app', password: 'freero123' };

type Mode = 'login' | 'signup';

/** "How did you find Freero?" (optional, one choice; stored as the answer's id, never as text). */
const SOURCE_OPTIONS: Array<SelectOption<DiscoverySource>> = [
  { value: 'search', label: tr('sourceSearch') },
  { value: 'ai_assistant', label: tr('sourceAiAssistant'), description: tr('sourceAiAssistantExamples') },
  { value: 'colleague', label: tr('sourceColleague') },
  { value: 'social', label: tr('sourceSocial') },
  { value: 'open_source', label: tr('sourceOpenSource') },
  { value: 'directory', label: tr('sourceDirectory') },
  { value: 'other', label: tr('sourceOther') },
];

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
  const [source, setSource] = useState<DiscoverySource | ''>('');
  const sourceId = useId();
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  // A provider sign-in that came back with ?error= (until the next attempt).
  const [providerError, setProviderError] = useState<string | null>(() => providerErrorText(params.get('error')));
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const firstRef = useRef<HTMLInputElement>(null);
  // The terms signing up agrees to: only once the operator has put them in effect (never drafts).
  const [terms, setTerms] = useState<SiteLegal['legal']>(null);
  useEffect(() => {
    if (mode !== 'signup') return;
    let live = true;
    api.siteLegal().then(
      (r) => live && setTerms(r.legal),
      () => live && setTerms(null),
    );
    return () => {
      live = false;
    };
  }, [mode]);
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
      } else await signup(name, email, password, source || undefined);
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
            ? tr('freeroIsHavingTroubleRight')
            : err.message
          : tr('couldNotReachFreeroCheck'),
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
        <span className="fr-authpage__sticky fr-authpage__sticky--a">{tr('planTheLaunch')}</span>
        <span className="fr-authpage__sticky fr-authpage__sticky--b">{tr('ideasWelcome')}</span>
        <span className="fr-authpage__blob" />
      </div>
      <main className="fr-authcard">
        <a href="/" className="fr-authcard__logo" aria-label={tr('freeroHome')}>
          <Logo size={36} />
        </a>
        <h1 className="fr-authcard__title">{isLogin ? tr('welcomeBack') : tr('createYourFreeroAccount')}</h1>
        <p className="fr-authcard__sub">
          {toBoard
            ? isLogin
              ? tr('logInToOpenThe')
              : tr('createAFreeAccountTo')
            : isLogin
              ? tr('logInToPickUp')
              : tr('freeForeverForYourFirst')}
        </p>

        <ProviderButtons next={next} verb={isLogin ? tr('continue') : tr('signUp')} />

        <form className="fr-authcard__form" onSubmit={submit} noValidate>
          {!isLogin ? (
            <Input
              ref={firstRef}
              label={tr('name')}
              icon={UserRound}
              size="lg"
              autoComplete="name"
              placeholder={tr('adaLovelace')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              error={errors.name}
            />
          ) : null}
          <Input
            ref={isLogin ? firstRef : undefined}
            label={tr('workEmail')}
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
                <strong>{sso.workspaceName}</strong> {sso.enforced ? tr('signsYouInWithSingle') : tr('usesSingleSignOn')}
              </span>
              <a className="fr-authcard__sso-btn" href={sso.startUrl} onClick={() => noteProviderSignIn('sso')}>
                <KeyRound size={16} aria-hidden />{' '}{tr('continueWithSso')}</a>
              {sso.enforced && isLogin ? (
                <button type="button" className="fr-authcard__sso-alt" onClick={() => setBreakGlass((b) => !b)}>
                  {breakGlass ? tr('hidePasswordSignIn') : tr('workspaceOwnerSignInWith')}
                </button>
              ) : null}
            </div>
          ) : null}
          {ssoOnly ? null : (
            <>
              <Input
                label={tr('password')}
                icon={Lock}
                size="lg"
                type={showPw ? 'text' : 'password'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                placeholder={isLogin ? tr('yourPassword') : tr('atLeast8Characters')}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                error={errors.password}
                suffix={
                  <IconButton
                    size={32}
                    icon={showPw ? EyeOff : Eye}
                    label={showPw ? tr('hidePassword') : tr('showPassword')}
                    tooltip={false}
                    onClick={() => setShowPw((s) => !s)}
                  />
                }
              />

              {isLogin ? null : (
                <div className="fr-authcard__source">
                  <label className="fr-authcard__source-label" htmlFor={sourceId}>
                    {tr('howDidYouFindFreero')} <span className="fr-authcard__optional">{tr('optional')}</span>
                  </label>
                  <Select<DiscoverySource | ''>
                    id={sourceId}
                    aria-label={tr('howDidYouFindFreero')}
                    width="100%"
                    placeholder={tr('chooseOne')}
                    // Once answered, it can be taken back.
                    options={source ? [{ value: '', label: tr('noAnswer') }, ...SOURCE_OPTIONS] : SOURCE_OPTIONS}
                    value={source}
                    onChange={setSource}
                  />
                </div>
              )}

              {isLogin ? (
                <Link className="fr-authcard__forgot" to={`/forgot-password${email.trim() ? `?email=${encodeURIComponent(email.trim())}` : ''}`}>{tr('forgotPassword')}</Link>
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
              {isLogin ? tr('logIn') : tr('createAccount')}
            </Button>
          )}
        </form>

        {import.meta.env.DEV ? (
          <div className="fr-authcard__demo">
            <Sparkles size={16} aria-hidden />
            <span>{tr('demoAccount')}{' '}<code>{DEMO.email}</code> / <code>{DEMO.password}</code>
            </span>
            {isLogin ? (
              <button type="button" className="fr-authcard__demo-btn" onClick={fillDemo}>{tr('fillIn')}</button>
            ) : null}
          </div>
        ) : null}

        {!isLogin && terms ? (
          <p className="fr-authcard__terms" data-testid="signup-terms">{tr('bySigningUpYouAgree')}{' '}<a href={terms.termsUrl}>{tr('termsOfService')}</a>{' '}{tr('andThe')}{' '}<a href={terms.acceptableUseUrl}>{tr('acceptableUsePolicy')}</a>{tr('andAcknowledgeThe')}{' '}<a href={terms.privacyUrl}>{tr('privacyPolicy')}</a>.
          </p>
        ) : null}

        <p className="fr-authcard__switch">
          {isLogin ? (
            <>{tr('newToFreero')}{' '}<Link to={`/signup${nextQuery}`}>{tr('createAnAccount')}</Link>
            </>
          ) : (
            <>{tr('alreadyHaveAnAccount')}{' '}<Link to={`/login${nextQuery}`}>{tr('logIn')}</Link>
            </>
          )}
        </p>
      </main>
    </div>
  );
}
