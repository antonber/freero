// Settings → API tokens, connected apps and the apps you develop (KAI-104). The secret of a new
// token or app is shown once; the server keeps only its hash.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppWindow, Copy, KeyRound, Pause, Play, Plug, Trash2 } from 'lucide-react';
import { API_SCOPES, type ApiScope, type AuthorizedApp, type OAuthClientInfo, type PersonalToken } from '@freero/shared';
import { Button, Input, Select, Spinner, TextArea, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { Section } from './Section';
import './api.css';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
const SCOPES = Object.keys(API_SCOPES) as ApiScope[];
/** Reserved scopes grant nothing yet: not offered. */
const OFFERED = SCOPES.filter((s) => s !== 'boards:suggest');
const EXPIRY = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'No expiry' },
];

function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const notify = useToast();
  return (
    <div className="fr-acct-api__secret" role="status">
      <p className="fr-acct__p">{label} Copy it now: it won’t be shown again.</p>
      <div className="fr-acct-api__secret-row">
        <code data-testid="api-secret">{value}</code>
        <Button
          size="sm"
          icon={Copy}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => notify('Copied', 'success'));
          }}
        >
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function Scopes({ scopes }: { scopes: string[] }) {
  return (
    <span className="fr-acct-api__scopes">
      {scopes.map((s) => (
        <span key={s} className="fr-acct-api__scope">
          {s}
        </span>
      ))}
    </span>
  );
}

export function ApiTokensSection() {
  const notify = useToast();
  const [tokens, setTokens] = useState<PersonalToken[] | null>(null);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiScope[]>(['boards:read']);
  const [expiry, setExpiry] = useState('90');
  const [secret, setSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.listApiTokens().then(({ tokens }) => setTokens(tokens), () => setError('Could not load your tokens'));
  }, []);
  useEffect(load, [load]);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('Give the token a name, so you can tell it apart later');
    if (!scopes.length) return setError('Pick at least one permission');
    setBusy(true);
    setError(null);
    try {
      const out = await api.createApiToken({ name: name.trim(), scopes, expiresInDays: expiry === 'never' ? null : Number(expiry) });
      setSecret(out.secret);
      setName('');
      load();
    } catch (err) {
      setError(errorText(err, 'Could not create the token'));
    } finally {
      setBusy(false);
    }
  };
  const pause = async (t: PersonalToken) => {
    try {
      await api.pauseApiToken(t.id, !t.paused);
      notify(t.paused ? `“${t.name}” works again` : `“${t.name}” is paused: it’s refused until you resume it`, 'info');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not change the token'), 'error');
    }
  };
  const revoke = async (t: PersonalToken) => {
    try {
      await api.revokeApiToken(t.id);
      notify(`Revoked “${t.name}”`, 'info');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not revoke the token'), 'error');
    }
  };

  return (
    <Section
      id="api-tokens"
      title="API tokens"
      description="Let scripts and integrations use the Freero API as you, with only the permissions you pick. They never do more than you can."
    >
      {secret ? <Secret label="This is your new token." value={secret} onDone={() => setSecret(null)} /> : null}
      {!tokens ? (
        error ? <p className="fr-acct__error">{error}</p> : <Spinner size={20} label="Loading tokens" />
      ) : tokens.length ? (
        <ul className="fr-acct-sessions">
          {tokens.map((t) => (
            <li key={t.id} className="fr-acct-session" data-testid="token-row">
              <span className="fr-acct-session__icon" aria-hidden>
                <KeyRound size={18} />
              </span>
              <span className="fr-acct-session__who">
                <span className="fr-acct-session__device">
                  {t.name}
                  <span className="fr-acct-api__hint">…{t.hint}</span>
                  {t.paused ? <span className="fr-acct-badge fr-acct-badge--warn">Paused</span> : null}
                  {t.expiresAt !== null && t.expiresAt < Date.now() ? <span className="fr-acct-badge fr-acct-badge--warn">Expired</span> : null}
                </span>
                <Scopes scopes={t.scopes} />
                <span className="fr-acct-session__meta">
                  {[
                    `Created ${relativeTime(t.createdAt)}`,
                    t.expiresAt === null ? 'never expires' : `expires ${new Date(t.expiresAt).toLocaleDateString()}`,
                    t.lastUsedAt ? `last used ${relativeTime(t.lastUsedAt)}` : 'never used',
                  ].join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="ghost" icon={t.paused ? Play : Pause} onClick={() => pause(t)}>
                {t.paused ? 'Resume' : 'Pause'}
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(t)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-acct__p">No tokens yet.</p>
      )}
      <form className="fr-acct-form fr-acct-api__new" onSubmit={create} noValidate>
        <div className="fr-acct-form__grid">
          <Input label="Token name" placeholder="e.g. Release notes script" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="fr-acct-api__field">
            <span className="fr-acct-api__label">Expires</span>
            <Select options={EXPIRY} value={expiry} onChange={setExpiry} aria-label="Expires" />
          </div>
        </div>
        <fieldset className="fr-acct-api__perms">
          <legend className="fr-acct-api__label">Permissions</legend>
          {OFFERED.map((s) => (
            <label key={s} className="fr-acct-api__perm">
              <input
                type="checkbox"
                checked={scopes.includes(s)}
                onChange={(e) => setScopes((cur) => (e.target.checked ? [...cur, s] : cur.filter((x) => x !== s)))}
              />
              <span>
                <code>{s}</code> {API_SCOPES[s]}
              </span>
            </label>
          ))}
        </fieldset>
        {error && tokens ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy}>
            Create token
          </Button>
        </div>
      </form>
    </Section>
  );
}

export function ConnectedAppsSection() {
  const notify = useToast();
  const [apps, setApps] = useState<AuthorizedApp[] | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    api.listAuthorizedApps().then(({ apps }) => setApps(apps), () => setFailed(true));
  }, []);
  useEffect(load, [load]);

  const revoke = async (a: AuthorizedApp) => {
    try {
      await api.revokeAuthorizedApp(a.clientId);
      notify(`${a.name} can no longer use your account`, 'info');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not revoke the app'), 'error');
    }
  };
  const revokeAll = async () => {
    try {
      const n = await api.revokeAllApiAccess();
      notify(`Disconnected ${n.apps} app${n.apps === 1 ? '' : 's'} and revoked ${n.tokens} token${n.tokens === 1 ? '' : 's'}`, 'info');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not disconnect everything'), 'error');
    }
  };

  return (
    <Section id="connected-apps" title="Connected apps" description="Apps and AI assistants you allowed to act for you. Revoking one stops it at once.">
      {failed ? (
        <p className="fr-acct__error">Could not load your apps.</p>
      ) : !apps ? (
        <Spinner size={20} label="Loading apps" />
      ) : apps.length ? (
        <ul className="fr-acct-sessions">
          {apps.map((a) => (
            <li key={a.clientId} className="fr-acct-session" data-testid="app-row">
              <span className="fr-acct-session__icon" aria-hidden>
                <Plug size={18} />
              </span>
              <span className="fr-acct-session__who">
                <span className="fr-acct-session__device">
                  {a.name}
                  {a.registration === 'dynamic' ? <span className="fr-acct-badge fr-acct-badge--warn">Not reviewed by Freero</span> : null}
                </span>
                <Scopes scopes={a.scopes} />
                <span className="fr-acct-session__meta">
                  {[`Allowed ${relativeTime(a.authorizedAt)}`, a.lastUsedAt ? `last used ${relativeTime(a.lastUsedAt)}` : 'not used yet', a.website].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(a)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-acct__p">No apps can use your account.</p>
      )}
      <div className="fr-acct-form__row">
        <Button variant="danger" onClick={revokeAll}>
          Disconnect all apps and tokens
        </Button>
      </div>
    </Section>
  );
}

export function DeveloperAppsSection() {
  const notify = useToast();
  const [clients, setClients] = useState<OAuthClientInfo[] | null>(null);
  const [name, setName] = useState('');
  const [website, setWebsite] = useState('');
  const [redirects, setRedirects] = useState('');
  const [confidential, setConfidential] = useState(false);
  const [secret, setSecret] = useState<{ clientId: string; secret: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api.listOAuthClients().then(({ clients }) => setClients(clients), () => setError('Could not load your apps'));
  }, []);
  useEffect(load, [load]);

  const register = async (e: FormEvent) => {
    e.preventDefault();
    const redirectUris = redirects.split(/\s+/).filter(Boolean);
    setBusy(true);
    setError(null);
    try {
      const out = await api.registerOAuthClient({ name: name.trim(), website: website.trim() || null, redirectUris, confidential });
      if (out.clientSecret) setSecret({ clientId: out.client.clientId, secret: out.clientSecret });
      else notify(`Registered ${out.client.name}`, 'success');
      setName('');
      setWebsite('');
      setRedirects('');
      load();
    } catch (err) {
      setError(errorText(err, 'Could not register the app'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: OAuthClientInfo) => {
    try {
      await api.deleteOAuthClient(c.clientId);
      notify(`Deleted ${c.name}: its users’ access ended`, 'info');
      load();
    } catch (err) {
      notify(errorText(err, 'Could not delete the app'), 'error');
    }
  };

  return (
    <Section
      id="developer-apps"
      title="Your OAuth apps"
      description="For developers: register an app so other people can connect it to their Freero account (authorization code with PKCE). AI clients that register themselves don’t need this."
    >
      {secret ? <Secret label={`This is the client secret of ${secret.clientId}.`} value={secret.secret} onDone={() => setSecret(null)} /> : null}
      {clients?.length ? (
        <ul className="fr-acct-sessions">
          {clients.map((c) => (
            <li key={c.clientId} className="fr-acct-session">
              <span className="fr-acct-session__icon" aria-hidden>
                <AppWindow size={18} />
              </span>
              <span className="fr-acct-session__who">
                <span className="fr-acct-session__device">
                  {c.name}
                  <span className="fr-acct-badge fr-acct-badge--ok">{c.confidential ? 'Confidential' : 'Public (PKCE)'}</span>
                </span>
                <span className="fr-acct-session__meta">
                  Client ID <code>{c.clientId}</code> · {c.users} {c.users === 1 ? 'person' : 'people'} connected
                </span>
                <span className="fr-acct-session__meta">{c.redirectUris.join(' · ')}</span>
              </span>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(c)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="fr-acct-form fr-acct-api__new" onSubmit={register} noValidate>
        <div className="fr-acct-form__grid">
          <Input label="App name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Website (optional)" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <TextArea
          label="Redirect URIs"
          hint="One per line: https, http on localhost (any port), or your app’s own scheme."
          rows={2}
          value={redirects}
          onChange={(e) => setRedirects(e.target.value)}
        />
        <Toggle label="Confidential app (gets a client secret; for apps with a server)" checked={confidential} onChange={setConfidential} />
        {error ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy}>
            Register app
          </Button>
        </div>
      </form>
    </Section>
  );
}
