// Settings → API tokens, connected apps and the apps you develop (KAI-104). The secret of a new
// token or app is shown once; the server keeps only its hash.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppWindow, Copy, KeyRound, Pause, Play, Plug, Trash2 } from 'lucide-react';
import { API_SCOPES, isOperatorScope, OPERATOR_SCOPES, type ApiScope, type AuthorizedApp, type OAuthClientInfo, type PersonalToken } from '@freero/shared';
import { Button, formatDate, Input, Select, Spinner, TextArea, Toggle, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { SettingsSection } from './Section';
import { t as tr } from './messages';
import './api.css';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.status < 500 ? err.message : fallback);
const SCOPES = Object.keys(API_SCOPES) as ApiScope[];
/** An app identified by its client metadata document (#81): the host its client_id URL names. */
const hostOf = (clientId: string) => {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
};
/** Reserved scopes grant nothing yet: not offered. Operator scopes only to operators (below). */
export const OFFERED = SCOPES.filter((s) => s !== 'boards:suggest' && !isOperatorScope(s));
export const EXPIRY = [
  { value: '7', label: tr('n7Days') },
  { value: '30', label: tr('n30Days') },
  { value: '90', label: tr('n90Days') },
  { value: '365', label: tr('n1Year') },
  { value: 'never', label: tr('noExpiry') },
];

export function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const notify = useToast();
  return (
    <div className="fr-acct-api__secret" role="status">
      <p className="fr-acct__p">{tr('labelCopyItNowIt', { label })}</p>
      <div className="fr-acct-api__secret-row">
        <code data-testid="api-secret">{value}</code>
        <Button
          size="sm"
          icon={Copy}
          onClick={() => {
            void navigator.clipboard?.writeText(value).then(() => notify(tr('copied'), 'success'));
          }}
        >{tr('copy')}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{tr('done')}</Button>
      </div>
    </div>
  );
}

export function Scopes({ scopes }: { scopes: string[] }) {
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
    api.listApiTokens().then(({ tokens }) => setTokens(tokens), () => setError(tr('couldNotLoadYourTokens')));
  }, []);
  useEffect(load, [load]);
  // Freero's operators (OPERATOR_EMAILS) may also make a token that triages problem reports.
  const [offered, setOffered] = useState<readonly ApiScope[]>(OFFERED);
  useEffect(() => {
    api.moderationAccess().then((r) => r.operator && setOffered([...OFFERED, ...OPERATOR_SCOPES]), () => undefined);
  }, []);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError(tr('giveTheTokenAName'));
    if (!scopes.length) return setError(tr('pickAtLeastOnePermission'));
    setBusy(true);
    setError(null);
    try {
      const out = await api.createApiToken({ name: name.trim(), scopes, expiresInDays: expiry === 'never' ? null : Number(expiry) });
      setSecret(out.secret);
      setName('');
      load();
    } catch (err) {
      setError(errorText(err, tr('couldNotCreateTheToken')));
    } finally {
      setBusy(false);
    }
  };
  const pause = async (t: PersonalToken) => {
    try {
      await api.pauseApiToken(t.id, !t.paused);
      notify(t.paused ? tr('nameWorksAgain', { name: t.name }) : tr('nameIsPausedItS', { name: t.name }), 'info');
      load();
    } catch (err) {
      notify(errorText(err, tr('couldNotChangeTheToken')), 'error');
    }
  };
  const revoke = async (t: PersonalToken) => {
    try {
      await api.revokeApiToken(t.id);
      notify(tr('revokedName', { name: t.name }), 'info');
      load();
    } catch (err) {
      notify(errorText(err, tr('couldNotRevokeTheToken')), 'error');
    }
  };

  return (
    <SettingsSection id="api-tokens" title={tr('apiTokens')} description={tr('tokens.description')}>
      {secret ? <Secret label={tr('thisIsYourNewToken')} value={secret} onDone={() => setSecret(null)} /> : null}
      {!tokens ? (
        error ? <p className="fr-acct__error">{error}</p> : <Spinner size={20} label={tr('loadingTokens')} />
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
                  {t.paused ? <span className="fr-acct-badge fr-acct-badge--warn">{tr('paused')}</span> : null}
                  {t.expiresAt !== null && t.expiresAt < Date.now() ? <span className="fr-acct-badge fr-acct-badge--warn">{tr('expired')}</span> : null}
                </span>
                <Scopes scopes={t.scopes} />
                <span className="fr-acct-session__meta">
                  {[
                    tr('tokens.created', { value: relativeTime(t.createdAt) }),
                    t.expiresAt === null ? tr('tokens.neverExpires') : tr('tokens.expiresOn', { date: formatDate(t.expiresAt) }),
                    t.lastUsedAt ? tr('lastUsedValue', { value: relativeTime(t.lastUsedAt) }) : tr('tokens.neverUsed'),
                  ].join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="ghost" icon={t.paused ? Play : Pause} onClick={() => pause(t)}>
                {t.paused ? tr('resume') : tr('pause')}
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(t)}>{tr('revoke')}</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-acct__p">{tr('noTokensYet')}</p>
      )}
      <form className="fr-acct-form fr-acct-api__new" onSubmit={create} noValidate>
        <div className="fr-acct-form__grid">
          <Input label={tr('tokenName')} placeholder={tr('eGReleaseNotesScript')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <div className="fr-acct-api__field">
            <span className="fr-acct-api__label">{tr('expires')}</span>
            <Select options={EXPIRY} value={expiry} onChange={setExpiry} aria-label={tr('expires')} />
          </div>
        </div>
        <fieldset className="fr-acct-api__perms">
          <legend className="fr-acct-api__label">{tr('permissions')}</legend>
          {offered.map((s) => (
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
          <Button type="submit" loading={busy}>{tr('createToken')}</Button>
        </div>
      </form>
    </SettingsSection>
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
      notify(tr('nameCanNoLongerUse', { name: a.name }), 'info');
      load();
    } catch (err) {
      notify(errorText(err, tr('couldNotRevokeTheApp')), 'error');
    }
  };
  const revokeAll = async () => {
    try {
      const n = await api.revokeAllApiAccess();
      notify(tr('disconnectedNAppsAndRevoked', { apps: n.apps, tokens: n.tokens }), 'info');
      load();
    } catch (err) {
      notify(errorText(err, tr('couldNotDisconnectEverything')), 'error');
    }
  };

  return (
    <SettingsSection id="connected-apps" title={tr('connectedApps')} description={tr('appsAndAiAssistantsYou')}>
      {failed ? (
        <p className="fr-acct__error">{tr('couldNotLoadYourApps')}</p>
      ) : !apps ? (
        <Spinner size={20} label={tr('loadingApps')} />
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
                  {a.registration === 'dynamic' ? <span className="fr-acct-badge fr-acct-badge--warn">{tr('notReviewedByFreero')}</span> : null}
                  {a.registration === 'metadata' ? <span className="fr-acct-badge">{hostOf(a.clientId)}</span> : null}
                </span>
                <Scopes scopes={a.scopes} />
                <span className="fr-acct-session__meta">
                  {[tr('apps.allowed', { value: relativeTime(a.authorizedAt) }), a.lastUsedAt ? tr('lastUsedValue', { value: relativeTime(a.lastUsedAt) }) : tr('apps.notUsedYet'), a.website].filter(Boolean).join(' · ')}
                </span>
              </span>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => revoke(a)}>{tr('revoke')}</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-acct__p">{tr('noAppsCanUseYour')}</p>
      )}
      <div className="fr-acct-form__row">
        <Button variant="danger" onClick={revokeAll}>{tr('disconnectAllAppsAndTokens')}</Button>
      </div>
    </SettingsSection>
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
    api.listOAuthClients().then(({ clients }) => setClients(clients), () => setError(tr('couldNotLoadYourApps2')));
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
      else notify(tr('registeredName', { name: out.client.name }), 'success');
      setName('');
      setWebsite('');
      setRedirects('');
      load();
    } catch (err) {
      setError(errorText(err, tr('couldNotRegisterTheApp')));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (c: OAuthClientInfo) => {
    try {
      await api.deleteOAuthClient(c.clientId);
      notify(tr('deletedNameItsUsersAccess', { name: c.name }), 'info');
      load();
    } catch (err) {
      notify(errorText(err, tr('couldNotDeleteTheApp')), 'error');
    }
  };

  return (
    <SettingsSection id="developer-apps" title={tr('yourOauthApps')} description={tr('oauthApps.description')}>
      {secret ? <Secret label={tr('thisIsTheClientSecret', { clientId: secret.clientId })} value={secret.secret} onDone={() => setSecret(null)} /> : null}
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
                  <span className="fr-acct-badge fr-acct-badge--ok">{c.confidential ? tr('confidential') : tr('publicPkce')}</span>
                </span>
                <span className="fr-acct-session__meta">{tr('clientId')}{' '}<code>{c.clientId}</code>{' '}{tr('usersPeopleConnected', { users: c.users })}</span>
                <span className="fr-acct-session__meta">{c.redirectUris.join(' · ')}</span>
              </span>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => remove(c)}>{tr('delete')}</Button>
            </li>
          ))}
        </ul>
      ) : null}
      <form className="fr-acct-form fr-acct-api__new" onSubmit={register} noValidate>
        <div className="fr-acct-form__grid">
          <Input label={tr('appName')} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label={tr('websiteOptional')} placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />
        </div>
        <TextArea
          label={tr('redirectUris')}
          hint={tr('onePerLineHttpsHttp')}
          rows={2}
          value={redirects}
          onChange={(e) => setRedirects(e.target.value)}
        />
        <Toggle label={tr('confidentialAppGetsAClient')} checked={confidential} onChange={setConfidential} />
        {error ? <p className="fr-acct__error" role="alert">{error}</p> : null}
        <div className="fr-acct-form__row">
          <Button type="submit" loading={busy}>{tr('registerApp')}</Button>
        </div>
      </form>
    </SettingsSection>
  );
}
