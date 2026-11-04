// Issue-tracker connections (KAI-153): a team's (admin console → Trackers, its owners/admins) or a
// person's own (Settings). Add one with an API token / personal access token, or OAuth where the
// server has an app for it; test it; see where the tracker should send webhooks (the secret is
// shown once, when made); remove it — sync stops, board items stay as they are. Tokens are sent
// once and never come back from the server.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, ListTree, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { TRACKER_PROVIDERS, type TrackerConnectionInfo, type TrackerConnectionInput, type TrackerProviderKind } from '@freero/shared';
import { Button, Input, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { relativeTime } from '../lib/time';
import { TrackerFieldMap } from './TrackerFieldMap';
import { t } from '../messages';
import './TrackerConnections.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : e instanceof ApiError ? e.message || fallback : fallback);

const PROVIDER_OPTIONS = (Object.keys(TRACKER_PROVIDERS) as TrackerProviderKind[]).map((p) => ({ value: p, label: TRACKER_PROVIDERS[p] }));

const SITE_PLACEHOLDER: Record<TrackerProviderKind, string> = {
  jira: 'https://your-team.atlassian.net',
  linear: 'https://linear.app',
  github: 'https://github.com (or your GitHub Enterprise address)',
  azure: 'https://dev.azure.com/your-organization',
  asana: 'https://app.asana.com',
  monday: 'https://monday.com',
};
const TOKEN_LABEL: Record<TrackerProviderKind, string> = { jira: t('apiToken'), linear: t('apiKey'), github: t('personalAccessToken'), azure: t('personalAccessTokenWorkItems'), asana: t('personalAccessToken'), monday: t('apiToken') };
/** Trackers where Freero registers its webhooks itself (nothing to paste there). */
const SELF_HOOKED: ReadonlySet<TrackerProviderKind> = new Set(['asana', 'monday']);
type OAuthOffered = Partial<Record<TrackerProviderKind, boolean>>;

function Secret({ value, onDone }: { value: string; onDone: () => void }) {
  const notify = useToast();
  return (
    <div className="fr-trackerconn__secret" role="status">
      <p>{t('webhookSecretPasteItInto')}</p>
      <div className="fr-trackerconn__secret-row">
        <code data-testid="tracker-webhook-secret">{value}</code>
        <Button size="sm" icon={Copy} onClick={() => void navigator.clipboard?.writeText(value).then(() => notify(t('copied'), 'success'))}>{t('copy')}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{t('done')}</Button>
      </div>
    </div>
  );
}

function AddConnection({ workspaceId, oauth, onAdded }: { workspaceId: string | null; oauth: OAuthOffered; onAdded: (c: TrackerConnectionInfo, secret: string) => void }) {
  const notify = useToast();
  const [provider, setProvider] = useState<TrackerProviderKind>('jira');
  const [deployment, setDeployment] = useState<'cloud' | 'datacenter'>('cloud');
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [inbound, setInbound] = useState<'webhook' | 'polling'>('webhook');
  const [project, setProject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: TrackerConnectionInput = {
      provider,
      name: name.trim() || TRACKER_PROVIDERS[provider],
      site: site.trim(),
      token,
      inbound,
      ...(workspaceId ? { workspaceId } : {}),
      ...(provider === 'jira' || provider === 'azure' ? { deployment } : {}),
      ...(provider === 'jira' && deployment === 'cloud' ? { email: email.trim() } : {}),
      ...(project.trim() ? { defaults: { project: project.trim() } } : {}),
    };
    try {
      const out = await api.createTrackerConnection(body);
      setToken('');
      onAdded(out.connection, out.webhookSecret);
      notify(t('connectedNameValue', { name: out.connection.name, value: out.connection.account ? t('asAccount', { account: out.connection.account }) : '' }), 'success');
    } catch (err) {
      setError(errorText(err, t('couldNotConnectTheTracker')));
    } finally {
      setBusy(false);
    }
  };

  const oauthUrl = `/api/trackers/oauth/${provider}/start?${new URLSearchParams({ ...(workspaceId ? { workspace: workspaceId } : {}), name: name.trim() || TRACKER_PROVIDERS[provider] })}`;
  const oauthOffered = provider === 'jira' ? deployment === 'cloud' && !!oauth.jira : !!oauth[provider];
  return (
    <form className="fr-trackerconn__form" onSubmit={submit} aria-label={t('connectATracker')}>
      <div className="fr-trackerconn__grid">
        <label>
          <span>{t('tracker')}</span>
          <Select aria-label={t('tracker')} options={PROVIDER_OPTIONS} value={provider} onChange={setProvider} width="100%" />
        </label>
        {provider === 'azure' && (
          <label>
            <span>{t('azureDevops')}</span>
            <Select
              aria-label={t('azureDevopsDeployment')}
              options={[
                { value: 'cloud', label: t('services'), description: 'dev.azure.com' },
                { value: 'datacenter', label: t('server'), description: t('yourOwnAddress2020Or') },
              ]}
              value={deployment}
              onChange={setDeployment}
              width="100%"
            />
          </label>
        )}
        {provider === 'jira' && (
          <label>
            <span>Jira</span>
            <Select
              aria-label={t('jiraDeployment')}
              options={[
                { value: 'cloud', label: t('cloud'), description: t('restV3ApiToken') },
                { value: 'datacenter', label: t('dataCenterServer'), description: t('restV2PersonalAccessToken') },
              ]}
              value={deployment}
              onChange={setDeployment}
              width="100%"
            />
          </label>
        )}
        <Input label={t('name')} value={name} placeholder={TRACKER_PROVIDERS[provider]} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Input label={t('address')} value={site} placeholder={SITE_PLACEHOLDER[provider]} onChange={(e) => setSite(e.target.value)} required={provider === 'jira' || provider === 'azure'} />
        {provider === 'jira' && deployment === 'cloud' && (
          <Input label={t('accountEmail')} type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} required />
        )}
        <Input
          label={provider === 'jira' && deployment === 'datacenter' ? t('personalAccessToken') : TOKEN_LABEL[provider]}
          type="password"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <Input
          label={
            provider === 'github'
              ? t('defaultRepositoryOwnerName')
              : provider === 'linear'
                ? t('defaultTeamKey')
                : provider === 'azure'
                  ? t('defaultProject')
                  : provider === 'asana'
                    ? t('defaultProjectItsIdOr')
                    : provider === 'monday'
                      ? t('defaultBoardItsIdOr')
                      : t('defaultProjectKey')
          }
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <label>
          <span>{t('changesFromTheTracker')}</span>
          <Select
            aria-label={t('changesFromTheTracker')}
            options={[
              { value: 'webhook', label: t('webhooks'), description: SELF_HOOKED.has(provider) ? t('instantFreeroRegistersThemItself') : t('instantTheTrackerMustReach') },
              { value: 'polling', label: t('polling'), description: t('everyMinuteForTrackersThat') },
            ]}
            value={inbound}
            onChange={setInbound}
            width="100%"
          />
        </label>
      </div>
      {error && (
        <p className="fr-trackerconn__error" role="alert">
          {error}
        </p>
      )}
      <div className="fr-trackerconn__actions">
        <Button type="submit" variant="primary" icon={Plug} loading={busy}>{t('connect')}</Button>
        {oauthOffered && (
          <Button type="button" icon={KeyRound} onClick={() => window.location.assign(oauthUrl)}>
            {provider === 'jira' ? t('connectWithAtlassianInstead') : t('connectWithTrackerProvidersInstead', { tracker_providers: TRACKER_PROVIDERS[provider] })}
          </Button>
        )}
      </div>
      <p className="fr-trackerconn__fine">{t('freeroTestsTheTokenRight')}</p>
    </form>
  );
}

export function TrackerConnections({ workspaceId }: { workspaceId: string | null }) {
  const notify = useToast();
  const [list, setList] = useState<TrackerConnectionInfo[] | null>(null);
  const [oauth, setOauth] = useState<OAuthOffered>({});
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [mapping, setMapping] = useState<string | null>(null);

  const load = useCallback(() => {
    api.trackerConnections(workspaceId).then(
      (r) => {
        setList(r.connections);
        setOauth(r.oauth);
      },
      (e) => notify(errorText(e, t('couldNotLoadTrackerConnections')), 'error'),
    );
  }, [workspaceId, notify]);
  useEffect(load, [load]);

  // Back from an OAuth consent: say how it went once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('tracker_error');
    if (err) notify(err, 'error');
    else if (q.get('tracker_connected')) notify(t('trackerConnected'), 'success');
  }, [notify]);

  const test = async (c: TrackerConnectionInfo) => {
    try {
      const r = await api.testTrackerConnection(c.id);
      setList((l) => l?.map((x) => (x.id === c.id ? r.connection : x)) ?? null);
      notify(t('nameWorksValue', { name: c.name, value: r.account ? t('asAccount2', { account: r.account }) : '' }), 'success');
    } catch (e) {
      notify(errorText(e, t('nameDidnTAnswer', { name: c.name })), 'error');
      load();
    }
  };
  const rotate = async (c: TrackerConnectionInfo) => {
    try {
      setSecret({ id: c.id, value: (await api.rotateTrackerWebhookSecret(c.id)).webhookSecret });
    } catch (e) {
      notify(errorText(e, t('couldNotMakeANew')), 'error');
    }
  };
  const remove = async (c: TrackerConnectionInfo) => {
    if (!window.confirm(t('removeNameItsLinksLinked', { links: c.links, name: c.name }))) return;
    try {
      await api.deleteTrackerConnection(c.id);
      setList((l) => l?.filter((x) => x.id !== c.id) ?? null);
      notify(t('removedName', { name: c.name }), 'success');
    } catch (e) {
      notify(errorText(e, t('couldNotRemoveIt')), 'error');
    }
  };

  if (!list) return <Spinner />;
  return (
    <div className="fr-trackerconn">
      {list.length === 0 && !adding && <p className="fr-trackerconn__fine">{t('noTrackerConnectedYet')}</p>}
      {list.map((c) => (
        <div key={c.id} className="fr-trackerconn__item" data-testid="tracker-connection">
          <div className="fr-trackerconn__head">
            <div>
              <div className="fr-trackerconn__name">
                {c.name}
                <span className={`fr-trackerconn__pill${c.status === 'active' ? '' : ' fr-trackerconn__pill--bad'}`}>{c.status === 'active' ? t('active') : t('needsAttention')}</span>
              </div>
              <div className="fr-trackerconn__meta">
                {TRACKER_PROVIDERS[c.provider]}
                {c.deployment ? ` ${c.provider === 'azure' ? (c.deployment === 'cloud' ? 'Services' : 'Server') : c.deployment === 'cloud' ? 'Cloud' : 'Data Center'}` : ''} · {c.site} · {c.auth === 'oauth' ? t('oauth') : 'token'}
                {c.account ? t('asAccount3', { account: c.account }) : ''}{' '}{t('linksLinkedIssuesAddedValue', { links: c.links, value: relativeTime(c.createdAt) })}</div>
              {c.lastError && <div className="fr-trackerconn__error">{c.lastError}</div>}
            </div>
            <div className="fr-trackerconn__buttons">
              <Button size="sm" icon={RefreshCw} onClick={() => void test(c)}>{t('test')}</Button>
              {c.fieldMap && c.provider !== 'linear' && c.provider !== 'github' && (
                <Button size="sm" variant="ghost" icon={ListTree} aria-expanded={mapping === c.id} onClick={() => setMapping(mapping === c.id ? null : c.id)}>{t('fieldMap')}</Button>
              )}
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(c)} aria-label={t('removeName', { name: c.name })}>{t('remove')}</Button>
            </div>
          </div>
          {SELF_HOOKED.has(c.provider) ? (
            <p className="fr-trackerconn__fine">
              {c.inbound === 'webhook'
                ? t('freeroRegistersItsOwnWebhooks', { tracker_providers: TRACKER_PROVIDERS[c.provider], value: c.provider === 'monday' ? t('board') : t('project') })
                : t('pollingEveryMinuteNothingIs', { tracker_providers: TRACKER_PROVIDERS[c.provider] })}
            </p>
          ) : (
            <div className="fr-trackerconn__webhook">
              <span>{c.inbound === 'webhook' ? t('webhookAddress') : t('pollingEveryMinuteWebhookAddress')}</span>
              <code>{c.webhookUrl}</code>
              <Button size="sm" variant="ghost" onClick={() => void rotate(c)}>{t('newSecret')}</Button>
            </div>
          )}
          {c.provider === 'azure' && (
            <p className="fr-trackerconn__fine">{t('inAzureDevopsProjectSettings')}</p>
          )}
          {secret?.id === c.id && <Secret value={secret.value} onDone={() => setSecret(null)} />}
          {mapping === c.id && (
            <TrackerFieldMap
              connection={c}
              onSaved={(next) => {
                setList((l) => l?.map((x) => (x.id === next.id ? next : x)) ?? null);
                setMapping(null);
              }}
            />
          )}

        </div>
      ))}
      {adding ? (
        <AddConnection
          workspaceId={workspaceId}
          oauth={oauth}
          onAdded={(c, s) => {
            setList((l) => [...(l ?? []), c]);
            // Nothing to paste where Freero registers its webhooks itself.
            if (!SELF_HOOKED.has(c.provider)) setSecret({ id: c.id, value: s });
            setAdding(false);
          }}
        />
      ) : (
        <Button icon={Plug} onClick={() => setAdding(true)}>{t('connectATracker')}</Button>
      )}
    </div>
  );
}
