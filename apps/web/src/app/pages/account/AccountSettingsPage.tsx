import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, BadgeCheck, Bot, CircleAlert, LayoutGrid, Download, ImageUp, LogOut, Mail, Monitor, ShieldCheck, Trash2 } from 'lucide-react';
import { describeDevice, type DataExportInfo, type NotificationPrefs, type SecurityInfo, type SessionInfo } from '@freero/shared';
import { Avatar, Button, ColorSwatches, Input, Logo, Modal, Spinner, Toggle, readableTextColor, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { relativeTime } from '../../lib/time';
import { ExportList } from '../admin/AdminIdentity';
import { TrackerConnections } from '../../components/TrackerConnections';
import { ApiTokensSection, ConnectedAppsSection, DeveloperAppsSection } from './ApiSections';
import { Section } from './Section';
import { isReauthRequired, needsReauth, ReauthPrompt, SignInMethodsSection, TwoFactorSection } from './SecuritySections';
import './account.css';

// Same palette the server assigns at signup: saturated enough to read on the canvas.
const CURSOR_COLORS = [
  '#E8590C', '#2F9E44', '#1C7ED6', '#9C36B5', '#D6336C', '#0C8599',
  '#F08C00', '#5F3DC4', '#C92A2A', '#087F5B', '#3B5BDB', '#A61E4D',
];

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);

/** /settings — profile, email, sign-in methods, password, two-step verification, devices, deletion. */
export function AccountSettingsPage() {
  useEffect(() => {
    document.title = 'Account settings · Freero';
  }, []);
  const navigate = useNavigate();
  const [security, setSecurity] = useState<SecurityInfo | null>(null);
  const [sessionsVersion, setSessionsVersion] = useState(0);
  const loadSecurity = useCallback(() => {
    api.security().then(setSecurity, () => undefined);
  }, []);
  useEffect(loadSecurity, [loadSecurity]);
  // Deep links (#trackers, #api-tokens, #sign-in…, e.g. from Apps & agents): the sections render
  // after the browser looked for the anchor, so scroll to it once they are there.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (id && id !== 'notifications') document.getElementById(id)?.scrollIntoView({ block: 'start' });
  }, []);
  const securityChanged = useCallback(() => {
    loadSecurity();
    setSessionsVersion((v) => v + 1);
  }, [loadSecurity]);
  return (
    <div className="fr-acct">
      <header className="fr-acct__top">
        <Link to="/app" className="fr-acct__back">
          <ArrowLeft size={16} aria-hidden /> Back to boards
        </Link>
        <Logo size={26} withWordmark />
      </header>
      <main className="fr-acct__main">
        <h1 className="fr-acct__title">Account settings</h1>
        <ProfileSection />
        <EmailSection security={security} />
        <NotificationsSection />
        <SignInMethodsSection security={security} onChange={setSecurity} />
        <PasswordSection security={security} onChanged={securityChanged} />
        <TwoFactorSection security={security} onChanged={securityChanged} />
        <SessionsSection version={sessionsVersion} />
        <Section
          id="connect-agent"
          title="AI agents"
          description="Connect Claude, ChatGPT, Claude Code, Cursor, VS Code or any MCP client to your boards: one click or one paste, with this server’s address filled in. Apps & agents lists everything else that connects."
        >
          <div className="fr-acct-form__row">
            <Button variant="primary" icon={Bot} onClick={() => navigate('/settings/connect')}>
              Connect an agent
            </Button>
            <Button variant="secondary" icon={LayoutGrid} onClick={() => navigate('/apps')}>
              Apps &amp; agents
            </Button>
          </div>
        </Section>
        <ConnectedAppsSection />
        <ApiTokensSection />
        <DeveloperAppsSection />
        <Section
          id="trackers"
          title="Your issue trackers"
          description="Your own Jira, Linear or GitHub connections, to send board items as issues on any board you can edit. Your team’s connections are set up in its admin console."
        >
          <TrackerConnections workspaceId={null} />
        </Section>
        <DataSection />
        <DeleteSection security={security} />
      </main>
    </div>
  );
}

function ProfileSection() {
  const { user, updateProfile, adopt } = useAuth();
  const notify = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [color, setColor] = useState(user?.color ?? CURSOR_COLORS[0]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  if (!user) return null;
  const dirty = name.trim() !== user.name || color !== user.color;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return setError('Your name can’t be empty');
    if (n.length > 80) return setError('Keep it under 80 characters');
    setSaving(true);
    try {
      await updateProfile({ name: n, color });
      notify('Profile updated', 'success');
    } catch (err) {
      notify(errorText(err, 'Could not save your profile'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    try {
      adopt((await api.uploadAvatar(f)).user);
      notify('Photo updated', 'success');
    } catch (err) {
      notify(errorText(err, 'Could not upload the photo'), 'error');
    } finally {
      setUploading(false);
      if (file.current) file.current.value = '';
    }
  };

  const removePhoto = async () => {
    try {
      adopt((await api.removeAvatar()).user);
    } catch (err) {
      notify(errorText(err, 'Could not remove the photo'), 'error');
    }
  };

  return (
    <Section id="profile" title="Profile" description="How collaborators see you on boards, in comments and in sharing.">
      <div className="fr-acct-avatar">
        <div className="fr-acct-preview">
          <Avatar name={name || user.name} color={color} src={user.avatarUrl} size={64} />
          <div className="fr-acct-preview__cursor" aria-hidden>
            <svg width="18" height="18" viewBox="0 0 18 18">
              <path d="M2 1.5 L15 8.2 L9.2 9.6 L6.6 15.6 Z" fill={color} stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
            <span style={{ background: color, color: readableTextColor(color) }}>{name.trim() || user.name}</span>
          </div>
        </div>
        <div className="fr-acct-avatar__actions">
          <input
            ref={file}
            type="file"
            accept="image/png,image/jpeg,image/gif"
            hidden
            aria-label="Choose a profile photo"
            onChange={(e) => upload(e.target.files?.[0])}
          />
          <Button icon={ImageUp} loading={uploading} onClick={() => file.current?.click()}>
            Upload photo
          </Button>
          {user.avatarUrl ? (
            <Button variant="ghost" onClick={removePhoto}>
              Remove
            </Button>
          ) : null}
          <span className="fr-acct__hint">PNG, JPEG or GIF. We crop it to a square.</span>
        </div>
      </div>
      <form className="fr-acct-form" onSubmit={save} noValidate>
        <Input label="Name" value={name} maxLength={80} onChange={(e) => (setName(e.target.value), setError(null))} error={error ?? undefined} />
        <div className="fr-field">
          <span className="fr-field__label">Cursor color</span>
          <ColorSwatches colors={CURSOR_COLORS} value={color} onChange={setColor} size={28} aria-label="Cursor color" />
        </div>
        <div className="fr-acct-form__row">
          <Button type="submit" variant="primary" loading={saving} disabled={!dirty}>
            Save profile
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** Which notifications are also emailed (as a digest); the in-app inbox always shows them. */
function NotificationsSection() {
  const { user } = useAuth();
  const notify = useToast();
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    api.notificationPrefs().then(
      (p) => live && setPrefs(p),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);
  // Arriving from the inbox's "Email settings" link or an unsubscribe page.
  useEffect(() => {
    if (prefs && window.location.hash === '#notifications') ref.current?.scrollIntoView({ block: 'start' });
  }, [prefs]);

  const save = async (patch: Parameters<typeof api.setNotificationPrefs>[0], optimistic: NotificationPrefs) => {
    const before = prefs;
    setPrefs(optimistic);
    try {
      setPrefs(await api.setNotificationPrefs(patch));
    } catch (err) {
      setPrefs(before);
      notify(errorText(err, 'Could not save your email settings'), 'error');
    }
  };

  if (!user) return null;
  return (
    <div ref={ref} id="notifications" className="fr-acct-anchor">
      <Section
        id="notifications-settings"
        title="Notification emails"
        description="Mentions, replies and shared boards always show under the bell. What you haven’t seen there a little later, we email you as one summary."
      >
        {failed ? (
          <p className="fr-acct__hint">Email settings couldn’t be loaded. Reload the page to try again.</p>
        ) : !prefs ? (
          <Spinner size={20} />
        ) : (
          <div className="fr-acct-prefs">
            {!user.emailVerified && (
              <p className="fr-acct-prefs__note">
                <CircleAlert size={15} aria-hidden /> Confirm your email address above to receive these emails.
              </p>
            )}
            <Toggle
              label={<span className="fr-acct-prefs__label">Email me about activity I haven’t seen</span>}
              checked={prefs.emailAll}
              onChange={(on) => save({ emailAll: on }, { ...prefs, emailAll: on })}
            />
            <ul className="fr-acct-prefs__types" aria-label="Email me about">
              {prefs.types.map((t) => (
                <li key={t.type} className={prefs.emailAll ? undefined : 'is-off'}>
                  <Toggle
                    size="sm"
                    disabled={!prefs.emailAll}
                    label={
                      <span className="fr-acct-prefs__type">
                        <span className="fr-acct-prefs__label">{t.label}</span>
                        <span className="fr-acct__hint">{t.description}</span>
                      </span>
                    }
                    checked={t.email}
                    onChange={(on) =>
                      save({ email: { [t.type]: on } }, { ...prefs, types: prefs.types.map((x) => (x.type === t.type ? { ...x, email: on } : x)) })
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        )}
      </Section>
    </div>
  );
}

function EmailSection({ security }: { security: SecurityInfo | null }) {
  const { user } = useAuth();
  const notify = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  // Accounts without a password confirm with a recent provider sign-in instead.
  const askPassword = security?.hasPassword ?? true;

  const resend = async () => {
    try {
      await api.resendVerification();
      notify(`Confirmation link sent to ${user.email}`, 'success');
    } catch (err) {
      notify(errorText(err, 'Could not send the link'), 'error');
    }
  };

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
      else setError(errorText(err, 'Could not start the change'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="email" title="Email address" description="Used to log in and to receive invites.">
      <div className="fr-acct-email">
        <Mail size={18} aria-hidden />
        <span className="fr-acct-email__addr">{user.email}</span>
        {user.emailVerified ? (
          <span className="fr-acct-badge fr-acct-badge--ok">
            <BadgeCheck size={14} aria-hidden /> Verified
          </span>
        ) : (
          <>
            <span className="fr-acct-badge fr-acct-badge--warn">
              <CircleAlert size={14} aria-hidden /> Not verified
            </span>
            <Button variant="ghost" size="sm" onClick={resend}>
              Resend link
            </Button>
          </>
        )}
      </div>
      <form className="fr-acct-form" onSubmit={change} noValidate>
        <div className="fr-acct-form__grid">
          <Input label="New email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {askPassword ? (
            <Input label="Current password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          ) : null}
        </div>
        {error ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        {security && (reauth || needsReauth(security)) && !askPassword ? <ReauthPrompt security={security} /> : null}
        {sentTo ? (
          <p className="fr-acct__ok" role="status">
            We sent a confirmation link to {sentTo}. Your address changes when you open it.
          </p>
        ) : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy} disabled={!email.trim() || (askPassword && !password) || (!askPassword && needsReauth(security))}>
            Change email
          </Button>
        </div>
      </form>
    </Section>
  );
}

function PasswordSection({ security, onChanged }: { security: SecurityInfo | null; onChanged: () => void }) {
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
    if (next.length < 8) return setError('Use at least 8 characters for the new password');
    setBusy(true);
    setError(null);
    try {
      await api.changePassword(current, next);
      setCurrent('');
      setNext('');
      notify(setting ? 'Password set. You can now also log in with your email.' : 'Password changed. Other devices were signed out.', 'success');
      if (setting) onChanged();
    } catch (err) {
      if (isReauthRequired(err)) setReauth(true);
      else setError(errorText(err, 'Could not change the password'));
    } finally {
      setBusy(false);
    }
  };

  const blocked = setting && needsReauth(security);
  return (
    <Section
      id="password"
      title={setting ? 'Set a password' : 'Password'}
      description={setting ? 'Add a password to also log in with your email address. Other devices are signed out.' : 'Changing it signs you out everywhere else.'}
    >
      <form className="fr-acct-form" onSubmit={submit} noValidate>
        <div className="fr-acct-form__grid">
          {setting ? null : (
            <Input label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          )}
          <Input label="New password" type="password" autoComplete="new-password" placeholder="At least 8 characters" value={next} onChange={(e) => setNext(e.target.value)} />
        </div>
        {error ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        {setting && (reauth || blocked) ? <ReauthPrompt security={security} /> : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy} disabled={(!setting && !current) || !next || blocked}>
            {setting ? 'Set password' : 'Change password'}
          </Button>
        </div>
      </form>
    </Section>
  );
}

/** "Google", "Password", "Reset link" — how a session signed in. */
function methodText(s: SessionInfo): string {
  if (s.methodLabel) return s.methodLabel;
  return s.method === 'email_link' ? 'Password reset link' : 'Password';
}

function SessionsSection({ version }: { version: number }) {
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
      notify(`Signed out ${describeDevice(s.userAgent)}`, 'info');
    } catch (err) {
      notify(errorText(err, 'Could not sign that device out'), 'error');
    }
  };

  const revokeOthers = async () => {
    try {
      const { revoked } = await api.revokeOtherSessions();
      setSessions((list) => list?.filter((x) => x.current) ?? null);
      notify(revoked === 1 ? 'Signed out 1 other session' : `Signed out ${revoked} other sessions`, 'info');
    } catch (err) {
      notify(errorText(err, 'Could not sign the other devices out'), 'error');
    }
  };

  const others = sessions?.filter((s) => !s.current).length ?? 0;
  return (
    <Section id="sessions" title="Where you're signed in" description="Sign out a device you don't recognize; its open boards disconnect right away.">
      {failed ? (
        <p className="fr-acct__error">Could not load your sessions.</p>
      ) : !sessions ? (
        <Spinner size={20} label="Loading sessions" />
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
                    {s.current ? <span className="fr-acct-badge fr-acct-badge--ok">This device</span> : null}
                  </span>
                  <span className="fr-acct-session__meta">
                    {[s.location ?? s.network, s.current ? 'Active now' : `Last active ${relativeTime(s.lastSeenAt)}`, `Signed in ${relativeTime(s.createdAt)}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span className="fr-acct-session__meta">
                    {`Signed in with ${methodText(s)}`}
                    {s.twoFactor ? (
                      <span className="fr-acct-session__2fa">
                        <ShieldCheck size={13} aria-hidden /> 2-step verified
                      </span>
                    ) : null}
                  </span>
                </span>
                {!s.current ? (
                  <Button size="sm" variant="ghost" icon={LogOut} onClick={() => revoke(s)}>
                    Sign out
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
          <div className="fr-acct-form__row">
            <Button onClick={revokeOthers} disabled={others === 0}>
              Sign out all other sessions
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

/** GDPR: a ZIP of everything Freero keeps about you, built in the background and emailed as a link. */
function DataSection() {
  const notify = useToast();
  const [exports, setExports] = useState<DataExportInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(() => api.myExports().then(({ exports }) => setExports(exports), () => undefined), []);
  useEffect(() => void refresh(), [refresh]);
  // While one is being prepared, look again now and then.
  const preparing = exports.some((e) => e.status === 'pending' || e.status === 'running');
  useEffect(() => {
    if (!preparing) return;
    const t = setInterval(() => void refresh(), 5000);
    return () => clearInterval(t);
  }, [preparing, refresh]);
  const ask = async () => {
    setBusy(true);
    try {
      await api.requestMyExport();
      notify('Preparing your data. We’ll email you a link when it’s ready.', 'success');
      void refresh();
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not start the export', 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section
      id="data"
      title="Your data"
      description="Download a ZIP of your profile, memberships, comments, the boards you own (as JSON and in Freero’s format, with their images), templates, uploads and notifications. Only you can download it, for 7 days."
    >
      <ExportList exports={exports} />
      <div>
        <Button icon={Download} loading={busy} disabled={preparing} onClick={() => void ask()}>
          {preparing ? 'Preparing…' : 'Download my data'}
        </Button>
      </div>
    </Section>
  );
}

function DeleteSection({ security }: { security: SecurityInfo | null }) {
  const { user, adopt } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reauth, setReauth] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!user) return null;
  const askPassword = security?.hasPassword ?? true;
  const blocked = !askPassword && (reauth || needsReauth(security));

  const confirm = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { deletionScheduledFor } = await api.deleteAccount(password);
      const day = new Date(deletionScheduledFor).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
      navigate('/login', { replace: true }); // before signing out here, or the guard adds ?next=/settings
      adopt(null);
      notify(`Your account will be deleted on ${day}. Log in before then to restore it.`, 'info', { duration: 12_000 });
    } catch (err) {
      if (isReauthRequired(err)) setReauth(true);
      else setError(errorText(err, 'Could not delete the account'));
      setBusy(false);
    }
  };

  return (
    <Section id="delete" title="Delete account" description="Removes your account, every board you own and your profile photo." danger>
      <div className="fr-acct-form__row">
        <Button variant="danger" icon={Trash2} onClick={() => (setOpen(true), setPassword(''), setError(null))}>
          Delete my account
        </Button>
      </div>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        width={460}
        footer={
          <>
            <Button onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="danger" loading={busy} disabled={(askPassword && !password) || blocked} onClick={() => confirm()}>
              Delete account
            </Button>
          </>
        }
      >
        <form className="fr-acct-form" onSubmit={confirm} noValidate>
          <p className="fr-acct__p">
            You'll be signed out everywhere. For 14 days you can log in and restore everything; after that your
            account, the boards you own and your profile photo are deleted for good. What you added to other people's
            boards stays with those boards, and your comments there will show as “Deleted user”.
          </p>
          {askPassword ? (
            <Input
              label="Enter your password to confirm"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              error={error ?? undefined}
            />
          ) : blocked && security ? (
            <ReauthPrompt security={security} />
          ) : error ? (
            <p className="fr-acct__error" role="alert">{error}</p>
          ) : null}
          <button type="submit" hidden />
        </form>
      </Modal>
    </Section>
  );
}
