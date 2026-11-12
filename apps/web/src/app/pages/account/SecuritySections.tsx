// Settings → Sign-in & security: the email address, sign-in methods (password + connected
// providers), the password, two-step verification and where you're signed in.
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BadgeCheck, CircleAlert, Copy, Download, KeyRound, Link2, LogOut, Mail, Monitor, ShieldCheck, ShieldOff, Unlink } from 'lucide-react';
import { describeDevice, REAUTH_REQUIRED, type SecurityInfo, type SessionInfo, type TwoFactorSetup } from '@freero/shared';
import { Button, Input, Modal, Spinner, useToast } from '@ui';
import { api, ApiError, providerUrl } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useVerificationResend } from '../../auth/verificationResend';
import { relativeTime } from '../../lib/time';
import { ProviderMark, providerErrorText } from '../auth/ProviderButtons';
import { SettingsSection } from './Section';
import { groupPath, SECTION_GROUP, type SettingsSectionId } from './sections';

import { t } from './messages';
export const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
export const isReauthRequired = (err: unknown) => err instanceof ApiError && err.code === REAUTH_REQUIRED;

/** A passwordless account confirms sensitive changes with a recent provider sign-in. */
export function needsReauth(security: SecurityInfo | null): boolean {
  return !!security && !security.hasPassword && Date.now() > security.recentAuthUntil;
}

/** "Confirm with Google": signs in with a connected provider again and comes back to `section`. */
export function ReauthPrompt({ security, section, children }: { security: SecurityInfo; section: SettingsSectionId; children?: ReactNode }) {
  const identity = security.identities.find((i) => security.providers.some((p) => p.id === i.provider));
  return (
    <div className="fr-acct-reauth" role="status">
      <span>{children ?? t('forYourSecurityConfirmIt')}</span>
      {identity ? (
        <a className="fr-acct-reauth__btn" href={providerUrl(identity.provider, 'reauth', `${groupPath(SECTION_GROUP[section])}#${section}`)}>
          <ProviderMark label={identity.providerLabel} />{' '}{t('confirmWithProviderlabel', { providerLabel: identity.providerLabel })}</a>
      ) : null}
    </div>
  );
}

/** "Password", "Google", "Microsoft" rows: what this account can log in with. */
export function SignInMethodsSection({
  security,
  onChange,
}: {
  security: SecurityInfo | null;
  onChange: (s: SecurityInfo) => void;
}) {
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  // Back from a provider: ?connected=google or ?error=… (then tidy the URL).
  useEffect(() => {
    const connected = params.get('connected');
    const err = params.get('error');
    if (!connected && !err) return;
    if (connected) notify(t('connectedYouCanNowLog'), 'success');
    if (err) setError(providerErrorText(err));
    const rest = new URLSearchParams(params);
    rest.delete('connected');
    rest.delete('error');
    setParams(rest, { replace: true });
  }, [params, setParams, notify]);

  if (!security) return null;
  const onlyWayIn = (id: string) => !security.hasPassword && security.identities.filter((i) => i.id !== id).length === 0;

  const disconnect = async (id: string, label: string) => {
    setError(null);
    try {
      onChange(await api.disconnectIdentity(id));
      notify(t('labelDisconnected', { label }), 'info');
    } catch (err) {
      setError(errorText(err, t('couldNotDisconnectLabel', { label })));
    }
  };

  const rows = [
    ...security.providers.map((p) => ({ provider: p.id, label: p.label, identity: security.identities.find((i) => i.provider === p.id) ?? null })),
    // Connected earlier through a provider that is no longer offered: can still be removed.
    ...security.identities
      .filter((i) => !security.providers.some((p) => p.id === i.provider))
      .map((i) => ({ provider: i.provider, label: i.providerLabel, identity: i })),
  ];

  return (
    <SettingsSection id="sign-in" title={t('signInMethods')} description={t('waysYouCanLogIn')}>
      <ul className="fr-acct-methods">
        <li className="fr-acct-method">
          <span className="fr-acct-method__icon" aria-hidden>
            <KeyRound size={16} />
          </span>
          <span className="fr-acct-method__who">
            <span className="fr-acct-method__name">{t('password')}</span>
            <span className="fr-acct-method__meta">{security.hasPassword ? t('set') : t('notSetYouLogIn')}</span>
          </span>
        </li>
        {rows.map(({ provider, label, identity }) => (
          <li key={provider} className="fr-acct-method" data-testid={`method-${provider}`}>
            <ProviderMark label={label} />
            <span className="fr-acct-method__who">
              <span className="fr-acct-method__name">{label}</span>
              <span className="fr-acct-method__meta">
                {identity
                  ? [identity.email ? t('connectedAsEmail', { email: identity.email }) : t('connectedPlain'), t('lastUsedValue', { value: relativeTime(identity.lastUsedAt) })].join(' · ')
                  : t('notConnected')}
              </span>
            </span>
            {identity ? (
              <Button
                size="sm"
                variant="ghost"
                icon={Unlink}
                disabled={onlyWayIn(identity.id)}
                aria-describedby={onlyWayIn(identity.id) ? 'fr-acct-only-way' : undefined}
                onClick={() => disconnect(identity.id, label)}
              >{t('disconnect')}</Button>
            ) : (
              <a className="fr-acct-method__connect" href={providerUrl(provider, 'link', '/settings')}>
                <Link2 size={14} aria-hidden />{' '}{t('connect')}</a>
            )}
          </li>
        ))}
      </ul>
      {!security.hasPassword && security.identities.length === 1 ? (
        <p className="fr-acct__hint" id="fr-acct-only-way">{t('toDisconnectProviderlabelSetA', { providerLabel: security.identities[0].providerLabel })}</p>
      ) : null}
      {error ? (
        <p className="fr-acct__error" role="alert">
          {error}
        </p>
      ) : null}
    </SettingsSection>
  );
}

// ---- two-step verification ----

type Step =
  | { kind: 'closed' }
  | { kind: 'confirm'; purpose: 'setup' }
  | { kind: 'scan'; setup: TwoFactorSetup }
  | { kind: 'codes'; codes: string[]; fresh: boolean }
  | { kind: 'verify'; purpose: 'disable' | 'regenerate' };

function RecoveryCodes({ codes }: { codes: string[] }) {
  const notify = useToast();
  const text = t('freeroRecoveryCodesEachCode', { codes: codes.join('\n') });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify(t('recoveryCodesCopied'), 'success');
    } catch {
      notify(t('couldNotCopySelectThe'), 'error');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'freero-recovery-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <>
      <ol className="fr-acct-codes" aria-label={t('recoveryCodes')}>
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="fr-acct-form__row">
        <Button size="sm" icon={Copy} onClick={copy}>{t('copy')}</Button>
        <Button size="sm" icon={Download} onClick={download}>{t('download')}</Button>
      </div>
    </>
  );
}

export function TwoFactorSection({
  security,
  onChanged,
}: {
  security: SecurityInfo | null;
  /** Re-fetch security info (and sessions: turning it on signs the other devices out). */
  onChanged: () => void;
}) {
  const { user } = useAuth();
  const notify = useToast();
  const [step, setStep] = useState<Step>({ kind: 'closed' });
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reauth, setReauth] = useState(false);
  if (!security || !user) return null;
  const tf = security.twoFactor;
  const askPassword = security.hasPassword;

  const reset = (next: Step) => {
    setStep(next);
    setPassword('');
    setCode('');
    setError(null);
    setBusy(false);
  };
  const close = () => {
    if (step.kind === 'codes') onChanged();
    reset({ kind: 'closed' });
  };
  const fail = (err: unknown, fallback: string) => {
    if (isReauthRequired(err)) {
      setReauth(true);
      reset({ kind: 'closed' });
      return;
    }
    setError(errorText(err, fallback));
    setBusy(false);
  };

  const begin = async (pw?: string) => {
    setBusy(true);
    setError(null);
    try {
      const setup = await api.setupTwoFactor(pw);
      reset({ kind: 'scan', setup });
    } catch (err) {
      fail(err, t('couldNotStartTheSetup'));
    }
  };

  const start = () => {
    setReauth(false);
    if (needsReauth(security)) return setReauth(true);
    if (askPassword) return reset({ kind: 'confirm', purpose: 'setup' });
    reset({ kind: 'closed' });
    void begin();
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { recoveryCodes } = await api.enableTwoFactor(code.trim());
      reset({ kind: 'codes', codes: recoveryCodes, fresh: true });
      notify(t('twoStepVerificationIsOn'), 'success');
    } catch (err) {
      fail(err, t('couldNotTurnItOn'));
    }
  };

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    if (step.kind !== 'verify') return;
    setBusy(true);
    setError(null);
    try {
      if (step.purpose === 'disable') {
        await api.disableTwoFactor(code.trim(), askPassword ? password : undefined);
        reset({ kind: 'closed' });
        notify(t('twoStepVerificationIsOff'), 'info');
        onChanged();
      } else {
        const { recoveryCodes } = await api.regenerateRecoveryCodes(code.trim(), askPassword ? password : undefined);
        reset({ kind: 'codes', codes: recoveryCodes, fresh: false });
      }
    } catch (err) {
      fail(err, t('thatDidnTWorkPlease'));
    }
  };

  const cancelRecovery = async () => {
    setBusy(true);
    try {
      await api.cancelTwoFactorRecovery();
      notify(t('recoveryCancelledTwoStepVerification'), 'success');
      onChanged();
    } catch (err) {
      notify(errorText(err, t('couldNotCancelTheRecovery')), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openVerify = (purpose: 'disable' | 'regenerate') => {
    setReauth(false);
    if (needsReauth(security)) return setReauth(true);
    reset({ kind: 'verify', purpose });
  };

  const passwordField = (
    <Input
      label={t('yourPassword')}
      type="password"
      autoComplete="current-password"
      value={password}
      onChange={(e) => setPassword(e.target.value)}
    />
  );
  const codeField = (label: string, hint?: string) => (
    <Input
      label={label}
      hint={hint}
      autoComplete="one-time-code"
      inputMode="numeric"
      maxLength={20}
      placeholder="123456"
      value={code}
      onChange={(e) => setCode(e.target.value)}
    />
  );
  const errorLine = error ? (
    <p className="fr-acct__error" role="alert">
      {error}
    </p>
  ) : null;

  return (
    <SettingsSection id="two-factor" title={t('twoStepVerification')} description={t('twoFactor.description')}>
      <div className="fr-acct-email">
        {tf.enabled ? <ShieldCheck size={18} aria-hidden /> : <ShieldOff size={18} aria-hidden />}
        <span className="fr-acct-email__addr">{tf.enabled ? t('authenticatorApp') : t('off')}</span>
        {tf.enabled ? (
          <>
            <span className="fr-acct-badge fr-acct-badge--ok">{t('on')}</span>
            <span className={tf.recoveryCodesLeft <= 3 ? 'fr-acct-badge fr-acct-badge--warn' : 'fr-acct__hint'}>
              {t('recoverycodesleftRecoveryCodesLeft', { recoveryCodesLeft: tf.recoveryCodesLeft })}
            </span>
          </>
        ) : null}
      </div>
      {tf.requiredBy ? <p className="fr-acct__hint">{tf.requiredBy}.</p> : null}
      {tf.recovery ? (
        <div className="fr-acct-form">
          <p className="fr-acct__error" role="alert">{t('someoneStartedAnAccountRecovery', { value: new Date(tf.recovery.readyAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) })}</p>
          <div className="fr-acct-form__row">
            <Button variant="danger" loading={busy && step.kind === 'closed'} onClick={cancelRecovery}>{t('cancelTheRecovery')}</Button>
          </div>
        </div>
      ) : null}
      {reauth ? <ReauthPrompt security={security} section="two-factor" /> : null}
      <div className="fr-acct-form__row">
        {tf.enabled ? (
          <>
            <Button onClick={() => openVerify('regenerate')}>{t('newRecoveryCodes')}</Button>
            <Button
              variant="ghost"
              disabled={!!tf.requiredBy}
              onClick={() => openVerify('disable')}
            >{t('turnOff')}</Button>
          </>
        ) : (
          <Button variant="primary" icon={ShieldCheck} loading={busy && step.kind === 'closed'} onClick={start}>{t('turnOn')}</Button>
        )}
      </div>

      <Modal
        open={step.kind === 'confirm'}
        onClose={close}
        title={t('turnOnTwoStepVerification')}
        width={440}
        footer={
          <>
            <Button onClick={close}>{t('cancel')}</Button>
            <Button variant="primary" loading={busy} disabled={!password} onClick={() => begin(password)}>{t('continue')}</Button>
          </>
        }
      >
        <form className="fr-acct-form" onSubmit={(e) => (e.preventDefault(), void begin(password))} noValidate>
          <p className="fr-acct__p">{t('firstConfirmItSYou')}</p>
          {passwordField}
          {errorLine}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal
        open={step.kind === 'scan'}
        onClose={close}
        title={t('scanWithYourAuthenticatorApp')}
        width={460}
        footer={
          <>
            <Button onClick={close}>{t('cancel')}</Button>
            <Button variant="primary" loading={busy} disabled={code.trim().length < 6} onClick={enable}>{t('turnOn')}</Button>
          </>
        }
      >
        {step.kind === 'scan' ? (
          <form className="fr-acct-form" onSubmit={enable} noValidate>
            <p className="fr-acct__p">{t('scanThisCodeWithAn')}</p>
            <div className="fr-acct-qr">
              <img src={step.setup.qr} alt={t('qrCodeForYourAuthenticator')} width={176} height={176} />
              <div className="fr-acct-qr__manual">
                <span className="fr-acct__hint">{t('canTScanItEnter')}</span>
                <code data-testid="totp-secret">{step.setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              </div>
            </div>
            {codeField(t('codeFromTheApp'))}
            {errorLine}
            <button type="submit" hidden />
          </form>
        ) : null}
      </Modal>

      <Modal
        open={step.kind === 'codes'}
        onClose={close}
        title={t('saveYourRecoveryCodes')}
        width={460}
        dismissable={false}
        footer={
          <Button variant="primary" onClick={close}>{t('iVeSavedThem')}</Button>
        }
      >
        {step.kind === 'codes' ? (
          <div className="fr-acct-form">
            <p className="fr-acct__p">{t('ifYouLoseYourPhone')}{step.fresh ? '' : t('yourPreviousCodesNoLonger')}
            </p>
            <RecoveryCodes codes={step.codes} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={step.kind === 'verify'}
        onClose={close}
        title={step.kind === 'verify' && step.purpose === 'disable' ? t('turnOffTwoStepVerification') : t('getNewRecoveryCodes')}
        width={440}
        footer={
          <>
            <Button onClick={close}>{t('cancel')}</Button>
            <Button
              variant={step.kind === 'verify' && step.purpose === 'disable' ? 'danger' : 'primary'}
              loading={busy}
              disabled={!code.trim() || (askPassword && !password)}
              onClick={verify}
            >
              {step.kind === 'verify' && step.purpose === 'disable' ? t('turnOff') : t('getNewCodes')}
            </Button>
          </>
        }
      >
        <form className="fr-acct-form" onSubmit={verify} noValidate>
          {step.kind === 'verify' && step.purpose === 'disable' ? (
            <p className="fr-acct__p">{askPassword ? t('twoFactor.offPassword') : t('twoFactor.offProvider')}</p>
          ) : (
            <p className="fr-acct__p">{t('yourCurrentRecoveryCodesWill')}</p>
          )}
          {askPassword ? passwordField : null}
          {codeField(t('codeFromYourAuthenticatorApp'), t('orOneOfYourRecovery'))}
          {errorLine}
          <button type="submit" hidden />
        </form>
      </Modal>
    </SettingsSection>
  );
}

export function EmailSection({ security }: { security: SecurityInfo | null }) {
  const { user } = useAuth();
  const verification = useVerificationResend(user?.email ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  // Accounts without a password confirm with a recent provider sign-in instead.
  const askPassword = security?.hasPassword ?? true;

  const change = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.changeEmail(email.trim(), password);
      setSentTo(email.trim());
      setEmail('');
      setPassword('');
    } catch (err) {
      if (isReauthRequired(err)) setReauth(true);
      else setError(errorText(err, t('couldNotStartTheChange')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsSection id="email" title={t('emailAddress')} description={t('usedToLogInAnd')}>
      <div className="fr-acct-email">
        <Mail size={18} aria-hidden />
        <span className="fr-acct-email__addr">{user.email}</span>
        {user.emailVerified ? (
          <span className="fr-acct-badge fr-acct-badge--ok">
            <BadgeCheck size={14} aria-hidden />{' '}{t('verified')}</span>
        ) : (
          <>
            <span className="fr-acct-badge fr-acct-badge--warn">
              <CircleAlert size={14} aria-hidden />{' '}{t('notVerified')}</span>
            <Button variant="ghost" size="sm" onClick={verification.resend} disabled={verification.busy}>{t('resendLink')}</Button>
          </>
        )}
      </div>
      {!user.emailVerified && verification.notice ? (
        <p className={verification.notice.kind === 'failed' ? 'fr-acct__error' : 'fr-acct__p'} role={verification.notice.kind === 'failed' ? 'alert' : 'status'}>
          {verification.notice.text}
        </p>
      ) : null}
      <form className="fr-acct-form" onSubmit={change} noValidate>
        <div className="fr-acct-form__grid">
          <Input label={t('newEmail')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {askPassword ? (
            <Input label={t('currentPassword')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          ) : null}
        </div>
        {error ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        {security && (reauth || needsReauth(security)) && !askPassword ? <ReauthPrompt security={security} section="email" /> : null}
        {sentTo ? (
          <p className="fr-acct__ok" role="status">{t('weSentAConfirmationLink', { sentTo })}</p>
        ) : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy} disabled={!email.trim() || (askPassword && !password) || (!askPassword && needsReauth(security))}>{t('changeEmail')}</Button>
        </div>
      </form>
    </SettingsSection>
  );
}

export function PasswordSection({ security, onChanged }: { security: SecurityInfo | null; onChanged: () => void }) {
  const notify = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!security) return null;
  // Signed up with a provider: no password yet. A recent sign-in stands in for the current one.
  const setting = !security.hasPassword;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next.length < 8) return setError(t('useAtLeast8Characters'));
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      notify(setting ? t('passwordSetYouCanNow') : t('passwordChangedOtherDevicesWere'), 'success');
      if (setting) onChanged();
    } catch (err) {
      if (isReauthRequired(err)) setReauth(true);
      else setError(errorText(err, t('couldNotChangeThePassword')));
    } finally {
      setBusy(false);
    }
  };

  const blocked = setting && needsReauth(security);
  return (
    <SettingsSection
      id="password"
      title={setting ? t('setAPassword') : t('password')}
      description={setting ? t('addAPasswordToAlso') : t('changingItSignsYouOut')}
    >
      <form className="fr-acct-form" onSubmit={submit} noValidate>
        <div className="fr-acct-form__grid">
          {setting ? null : (
            <Input label={t('currentPassword')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          )}
          <Input label={t('newPassword')} type="password" autoComplete="new-password" placeholder={t('atLeast8Characters')} value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        {error ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        {setting && (reauth || blocked) ? <ReauthPrompt security={security} section="password" /> : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy} disabled={(!setting && !current) || !next || blocked}>
            {setting ? t('setPassword') : t('changePassword')}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
}

/** "Google", "Password", "Reset link" — how a session signed in. */
function methodText(s: SessionInfo): string {
  if (s.methodLabel) return s.methodLabel;
  return s.method === 'email_link' ? t('passwordResetLink') : t('password');
}

export function SessionsSection({ version }: { version: number }) {
  const notify = useToast();
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    api.listSessions().then(
      ({ sessions }) => setSessions(sessions),
      () => setFailed(true),
    );
  }, []);
  useEffect(load, [load, version]);

  const revoke = async (s: SessionInfo) => {
    try {
      await api.revokeSession(s.id);
      setSessions((list) => list?.filter((x) => x.id !== s.id) ?? null);
      notify(t('signedOutDescribedevice', { describeDevice: describeDevice(s.userAgent) }), 'info');
    } catch (err) {
      notify(errorText(err, t('couldNotSignThatDevice')), 'error');
    }
  };

  const revokeOthers = async () => {
    try {
      const { revoked } = await api.revokeOtherSessions();
      setSessions((list) => list?.filter((x) => x.current) ?? null);
      notify(t('signedOutRevokedOtherSessions', { revoked }), 'info');
    } catch (err) {
      notify(errorText(err, t('couldNotSignTheOther')), 'error');
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;
  return (
    <SettingsSection id="sessions" title={t('whereYouReSignedIn')} description={t('signOutADeviceYou')}>
      {failed ? (
        <p className="fr-acct__error">{t('couldNotLoadYourSessions')}</p>
      ) : !sessions ? (
        <Spinner size={20} label={t('loadingSessions')} />
      ) : (
        <>
          <ul className="fr-acct-sessions">
            {sessions.map((s) => (
              <li key={s.id} className="fr-acct-session" data-testid="session-row">
                <span className="fr-acct-session__icon" aria-hidden>
                  <Monitor size={18} />
                </span>
                <span className="fr-acct-session__who">
                  <span className="fr-acct-session__device">
                    {describeDevice(s.userAgent)}
                    {s.current ? <span className="fr-acct-badge fr-acct-badge--ok">{t('thisDevice')}</span> : null}
                  </span>
                  <span className="fr-acct-session__meta">
                    {[s.location ?? s.network, s.current ? t('activeNow') : t('lastActiveValue', { value: relativeTime(s.lastSeenAt) }), t('signedInValue', { value: relativeTime(s.createdAt) })]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="fr-acct-session__meta">
                    {t('signedInWithMethodtext', { methodText: methodText(s) })}
                    {s.twoFactor ? (
                      <span className="fr-acct-session__2fa">
                        <ShieldCheck size={13} aria-hidden />{' '}{t('n2StepVerified')}</span>
                    ) : null}
                  </span>
                </span>
                {!s.current ? (
                  <Button size="sm" variant="ghost" icon={LogOut} onClick={() => revoke(s)}>{t('signOut')}</Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="fr-acct-form__row">
            <Button onClick={revokeOthers} disabled={others === 0}>{t('signOutAllOtherSessions')}</Button>
          </div>
        </>
      )}
    </SettingsSection>
  );
}
