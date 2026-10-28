// Settings: sign-in methods (password + connected providers) and two-step verification.
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Copy, Download, KeyRound, Link2, ShieldCheck, ShieldOff, Unlink } from 'lucide-react';
import { REAUTH_REQUIRED, type SecurityInfo, type TwoFactorSetup } from '@freero/shared';
import { Button, Input, Modal, useToast } from '@ui';
import { api, ApiError, providerUrl } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { relativeTime } from '../../lib/time';
import { ProviderMark, providerErrorText } from '../auth/ProviderButtons';
import { Section } from './Section';

export const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
export const isReauthRequired = (err: unknown) => err instanceof ApiError && err.code === REAUTH_REQUIRED;

/** A passwordless account confirms sensitive changes with a recent provider sign-in. */
export function needsReauth(security: SecurityInfo | null): boolean {
  return !!security && !security.hasPassword && Date.now() > security.recentAuthUntil;
}

/** "Confirm with Google": signs in with a connected provider again and comes back here. */
export function ReauthPrompt({ security, children }: { security: SecurityInfo; children?: ReactNode }) {
  const identity = security.identities.find((i) => security.providers.some((p) => p.id === i.provider));
  return (
    <div className="fr-acct-reauth" role="status">
      <span>{children ?? 'For your security, confirm it’s you before changing this.'}</span>
      {identity ? (
        <a className="fr-acct-reauth__btn" href={providerUrl(identity.provider, 'reauth', '/settings')}>
          <ProviderMark label={identity.providerLabel} /> Confirm with {identity.providerLabel}
        </a>
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
    if (connected) notify('Connected. You can now log in with it.', 'success');
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
      notify(`${label} disconnected`, 'info');
    } catch (err) {
      setError(errorText(err, `Could not disconnect ${label}`));
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
    <Section id="sign-in" title="Sign-in methods" description="Ways you can log in to this account.">
      <ul className="fr-acct-methods">
        <li className="fr-acct-method">
          <span className="fr-acct-method__icon" aria-hidden>
            <KeyRound size={16} />
          </span>
          <span className="fr-acct-method__who">
            <span className="fr-acct-method__name">Password</span>
            <span className="fr-acct-method__meta">{security.hasPassword ? 'Set' : 'Not set — you log in with a provider'}</span>
          </span>
        </li>
        {rows.map(({ provider, label, identity }) => (
          <li key={provider} className="fr-acct-method" data-testid={`method-${provider}`}>
            <ProviderMark label={label} />
            <span className="fr-acct-method__who">
              <span className="fr-acct-method__name">{label}</span>
              <span className="fr-acct-method__meta">
                {identity
                  ? [identity.email ? `Connected as ${identity.email}` : 'Connected', `last used ${relativeTime(identity.lastUsedAt)}`].join(' · ')
                  : 'Not connected'}
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
              >
                Disconnect
              </Button>
            ) : (
              <a className="fr-acct-method__connect" href={providerUrl(provider, 'link', '/settings')}>
                <Link2 size={14} aria-hidden /> Connect
              </a>
            )}
          </li>
        ))}
      </ul>
      {!security.hasPassword && security.identities.length === 1 ? (
        <p className="fr-acct__hint" id="fr-acct-only-way">
          To disconnect {security.identities[0].providerLabel}, set a password below or connect another provider first.
        </p>
      ) : null}
      {error ? (
        <p className="fr-acct__error" role="alert">
          {error}
        </p>
      ) : null}
    </Section>
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
  const text = `Freero recovery codes\n\nEach code signs you in once if you can't use your authenticator app.\n\n${codes.join('\n')}\n`;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify('Recovery codes copied', 'success');
    } catch {
      notify('Could not copy. Select the codes and copy them by hand.', 'error');
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
      <ol className="fr-acct-codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ol>
      <div className="fr-acct-form__row">
        <Button size="sm" icon={Copy} onClick={copy}>
          Copy
        </Button>
        <Button size="sm" icon={Download} onClick={download}>
          Download
        </Button>
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
      fail(err, 'Could not start the setup');
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
      notify('Two-step verification is on. Other devices were signed out.', 'success');
    } catch (err) {
      fail(err, 'Could not turn it on');
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
        notify('Two-step verification is off', 'info');
        onChanged();
      } else {
        const { recoveryCodes } = await api.regenerateRecoveryCodes(code.trim(), askPassword ? password : undefined);
        reset({ kind: 'codes', codes: recoveryCodes, fresh: false });
      }
    } catch (err) {
      fail(err, 'That didn’t work. Please try again.');
    }
  };

  const cancelRecovery = async () => {
    setBusy(true);
    try {
      await api.cancelTwoFactorRecovery();
      notify('Recovery cancelled. Two-step verification stays on.', 'success');
      onChanged();
    } catch (err) {
      notify(errorText(err, 'Could not cancel the recovery'), 'error');
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
      label="Your password"
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
    <Section
      id="two-factor"
      title="Two-step verification"
      description="When you log in, Freero also asks for a code from an authenticator app on your phone."
    >
      <div className="fr-acct-email">
        {tf.enabled ? <ShieldCheck size={18} aria-hidden /> : <ShieldOff size={18} aria-hidden />}
        <span className="fr-acct-email__addr">{tf.enabled ? 'Authenticator app' : 'Off'}</span>
        {tf.enabled ? (
          <>
            <span className="fr-acct-badge fr-acct-badge--ok">On</span>
            <span className={tf.recoveryCodesLeft <= 3 ? 'fr-acct-badge fr-acct-badge--warn' : 'fr-acct__hint'}>
              {tf.recoveryCodesLeft === 1 ? '1 recovery code left' : `${tf.recoveryCodesLeft} recovery codes left`}
            </span>
          </>
        ) : null}
      </div>
      {tf.requiredBy ? <p className="fr-acct__hint">{tf.requiredBy}.</p> : null}
      {tf.recovery ? (
        <div className="fr-acct-form">
          <p className="fr-acct__error" role="alert">
            Someone started an account recovery that removes two-step verification on{' '}
            {new Date(tf.recovery.readyAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}. If it wasn’t you, cancel
            it and change your password.
          </p>
          <div className="fr-acct-form__row">
            <Button variant="danger" loading={busy && step.kind === 'closed'} onClick={cancelRecovery}>
              Cancel the recovery
            </Button>
          </div>
        </div>
      ) : null}
      {reauth ? <ReauthPrompt security={security} /> : null}
      <div className="fr-acct-form__row">
        {tf.enabled ? (
          <>
            <Button onClick={() => openVerify('regenerate')}>New recovery codes</Button>
            <Button
              variant="ghost"
              disabled={!!tf.requiredBy}
              onClick={() => openVerify('disable')}
            >
              Turn off
            </Button>
          </>
        ) : (
          <Button variant="primary" icon={ShieldCheck} loading={busy && step.kind === 'closed'} onClick={start}>
            Turn on
          </Button>
        )}
      </div>

      <Modal
        open={step.kind === 'confirm'}
        onClose={close}
        title="Turn on two-step verification"
        width={440}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={!password} onClick={() => begin(password)}>
              Continue
            </Button>
          </>
        }
      >
        <form className="fr-acct-form" onSubmit={(e) => (e.preventDefault(), void begin(password))} noValidate>
          <p className="fr-acct__p">First, confirm it’s you.</p>
          {passwordField}
          {errorLine}
          <button type="submit" hidden />
        </form>
      </Modal>

      <Modal
        open={step.kind === 'scan'}
        onClose={close}
        title="Scan with your authenticator app"
        width={460}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button variant="primary" loading={busy} disabled={code.trim().length < 6} onClick={enable}>
              Turn on
            </Button>
          </>
        }
      >
        {step.kind === 'scan' ? (
          <form className="fr-acct-form" onSubmit={enable} noValidate>
            <p className="fr-acct__p">
              Scan this code with an authenticator app (for example the one built into your password manager), then enter the
              6-digit code it shows.
            </p>
            <div className="fr-acct-qr">
              <img src={step.setup.qr} alt="QR code for your authenticator app" width={176} height={176} />
              <div className="fr-acct-qr__manual">
                <span className="fr-acct__hint">Can’t scan it? Enter this key:</span>
                <code data-testid="totp-secret">{step.setup.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              </div>
            </div>
            {codeField('Code from the app')}
            {errorLine}
            <button type="submit" hidden />
          </form>
        ) : null}
      </Modal>

      <Modal
        open={step.kind === 'codes'}
        onClose={close}
        title="Save your recovery codes"
        width={460}
        dismissable={false}
        footer={
          <Button variant="primary" onClick={close}>
            I’ve saved them
          </Button>
        }
      >
        {step.kind === 'codes' ? (
          <div className="fr-acct-form">
            <p className="fr-acct__p">
              If you lose your phone, each of these codes lets you log in once. Keep them somewhere safe — they won’t be shown
              again.{step.fresh ? '' : ' Your previous codes no longer work.'}
            </p>
            <RecoveryCodes codes={step.codes} />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={step.kind === 'verify'}
        onClose={close}
        title={step.kind === 'verify' && step.purpose === 'disable' ? 'Turn off two-step verification?' : 'Get new recovery codes'}
        width={440}
        footer={
          <>
            <Button onClick={close}>Cancel</Button>
            <Button
              variant={step.kind === 'verify' && step.purpose === 'disable' ? 'danger' : 'primary'}
              loading={busy}
              disabled={!code.trim() || (askPassword && !password)}
              onClick={verify}
            >
              {step.kind === 'verify' && step.purpose === 'disable' ? 'Turn off' : 'Get new codes'}
            </Button>
          </>
        }
      >
        <form className="fr-acct-form" onSubmit={verify} noValidate>
          {step.kind === 'verify' && step.purpose === 'disable' ? (
            <p className="fr-acct__p">Your account will be protected by your {askPassword ? 'password' : 'sign-in provider'} alone.</p>
          ) : (
            <p className="fr-acct__p">Your current recovery codes will stop working.</p>
          )}
          {askPassword ? passwordField : null}
          {codeField('Code from your authenticator app', 'Or one of your recovery codes')}
          {errorLine}
          <button type="submit" hidden />
        </form>
      </Modal>
    </Section>
  );
}
