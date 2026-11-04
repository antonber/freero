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
  clickup: 'https://app.clickup.com',
  trello: 'https://trello.com',
};
const TOKEN_LABEL: Record<TrackerProviderKind, string> = {
  jira: 'API token',
  linear: 'API key',
  github: 'Personal access token',
  azure: 'Personal access token (Work Items: read & write)',
  asana: 'Personal access token',
  monday: 'API token',
  clickup: 'Personal token (pk_…)',
  trello: 'Token',
};
/** Trackers where Freero registers its webhooks itself (nothing to paste there). */
const SELF_HOOKED: ReadonlySet<TrackerProviderKind> = new Set(['asana', 'monday', 'clickup', 'trello']);
/** What each tracker calls the place issues live, for "Default …" and the webhook note. */
const PLACE: Partial<Record<TrackerProviderKind, string>> = { monday: 'board', clickup: 'List', trello: 'board' };
type OAuthOffered = Partial<Record<TrackerProviderKind, boolean>>;
/** The operator's Trello API key, when there is one: then a person only pastes a token for it. */
type TrelloOffer = { key: string | null; authorizeUrl: string | null };

function Secret({ value, onDone }: { value: string; onDone: () => void }) {
  const notify = useToast();
  return (
    <div className="fr-trackerconn__secret" role="status">
      <p>
        Webhook secret — paste it into the tracker’s webhook settings with the address above. Copy it now: it won’t be shown again.
      </p>
      <div className="fr-trackerconn__secret-row">
        <code data-testid="tracker-webhook-secret">{value}</code>
        <Button size="sm" icon={Copy} onClick={() => void navigator.clipboard?.writeText(value).then(() => notify('Copied', 'success'))}>
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

function AddConnection({ workspaceId, oauth, trello, onAdded }: { workspaceId: string | null; oauth: OAuthOffered; trello: TrelloOffer; onAdded: (c: TrackerConnectionInfo, secret: string) => void }) {
  const notify = useToast();
  const [provider, setProvider] = useState<TrackerProviderKind>('jira');
  const [deployment, setDeployment] = useState<'cloud' | 'datacenter'>('cloud');
  const [name, setName] = useState('');
  const [site, setSite] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [apiSecret, setApiSecret] = useState('');
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
      // Trello: the person's own API key (and its secret) when the server has none of its own.
      ...(provider === 'trello' && !trello.key ? { apiKey: apiKey.trim(), ...(apiSecret.trim() ? { apiSecret: apiSecret.trim() } : {}) } : {}),
    };
    try {
      const out = await api.createTrackerConnection(body);
      setToken('');
      setApiSecret('');
      onAdded(out.connection, out.webhookSecret);
      notify(`Connected ${out.connection.name}${out.connection.account ? ` as ${out.connection.account}` : ''}`, 'success');
    } catch (err) {
      setError(errorText(err, 'Could not connect the tracker'));
    } finally {
      setBusy(false);
    }
  };

  const oauthUrl = `/api/trackers/oauth/${provider}/start?${new URLSearchParams({ ...(workspaceId ? { workspace: workspaceId } : {}), name: name.trim() || TRACKER_PROVIDERS[provider] })}`;
  const oauthOffered = provider === 'jira' ? deployment === 'cloud' && !!oauth.jira : !!oauth[provider];
  return (
    <form className="fr-trackerconn__form" onSubmit={submit} aria-label="Connect a tracker">
      <div className="fr-trackerconn__grid">
        <label>
          <span>Tracker</span>
          <Select aria-label="Tracker" options={PROVIDER_OPTIONS} value={provider} onChange={setProvider} width="100%" />
        </label>
        {provider === 'azure' && (
          <label>
            <span>Azure DevOps</span>
            <Select
              aria-label="Azure DevOps deployment"
              options={[
                { value: 'cloud', label: 'Services', description: 'dev.azure.com' },
                { value: 'datacenter', label: 'Server', description: 'Your own address (2020 or later)' },
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
              aria-label="Jira deployment"
              options={[
                { value: 'cloud', label: 'Cloud', description: 'REST v3, API token' },
                { value: 'datacenter', label: 'Data Center / Server', description: 'REST v2, personal access token' },
              ]}
              value={deployment}
              onChange={setDeployment}
              width="100%"
            />
          </label>
        )}
        <Input label="Name" value={name} placeholder={TRACKER_PROVIDERS[provider]} maxLength={80} onChange={(e) => setName(e.target.value)} />
        <Input label="Address" value={site} placeholder={SITE_PLACEHOLDER[provider]} onChange={(e) => setSite(e.target.value)} required={provider === 'jira' || provider === 'azure'} />
        {provider === 'jira' && deployment === 'cloud' && (
          <Input label="Account email" type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} required />
        )}
        {provider === 'trello' && !trello.key && (
          <Input label="API key (trello.com/power-ups/admin)" value={apiKey} autoComplete="off" onChange={(e) => setApiKey(e.target.value)} required />
        )}
        <Input
          label={provider === 'jira' && deployment === 'datacenter' ? 'Personal access token' : TOKEN_LABEL[provider]}
          type="password"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
          required
        />
        {provider === 'trello' && !trello.key && (
          <Input label="API secret (optional: verifies Trello’s webhooks)" type="password" value={apiSecret} autoComplete="off" onChange={(e) => setApiSecret(e.target.value)} />
        )}
        <Input
          label={
            provider === 'github'
              ? 'Default repository (owner/name)'
              : provider === 'linear'
                ? 'Default team key'
                : provider === 'azure'
                  ? 'Default project'
                  : provider === 'asana'
                    ? 'Default project (its id or name)'
                    : provider === 'monday'
                      ? 'Default board (its id or name)'
                      : provider === 'clickup'
                        ? 'Default List (its id or name)'
                        : provider === 'trello'
                          ? 'Default board (its id)'
                          : 'Default project key'
          }
          value={project}
          onChange={(e) => setProject(e.target.value)}
        />
        <label>
          <span>Changes from the tracker</span>
          <Select
            aria-label="Changes from the tracker"
            options={[
              { value: 'webhook', label: 'Webhooks', description: SELF_HOOKED.has(provider) ? 'Instant; Freero registers them itself' : 'Instant; the tracker must reach this server' },
              { value: 'polling', label: 'Polling', description: 'Every minute; for trackers that can’t reach Freero' },
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
        <Button type="submit" variant="primary" icon={Plug} loading={busy}>
          Connect
        </Button>
        {oauthOffered && (
          <Button type="button" icon={KeyRound} onClick={() => window.location.assign(oauthUrl)}>
            {provider === 'jira' ? 'Connect with Atlassian instead' : `Connect with ${TRACKER_PROVIDERS[provider]} instead`}
          </Button>
        )}
      </div>
      {provider === 'trello' && trello.authorizeUrl && (
        <p className="fr-trackerconn__fine">
          <a href={trello.authorizeUrl} target="_blank" rel="noopener noreferrer">
            Get a token from Trello
          </a>{' '}
          (allow Freero there, then paste the token it shows above).
        </p>
      )}
      <p className="fr-trackerconn__fine">
        Freero tests the token right away and keeps it encrypted; it is never shown again. Issues are created as that account.
      </p>
    </form>
  );
}

export function TrackerConnections({ workspaceId }: { workspaceId: string | null }) {
  const notify = useToast();
  const [list, setList] = useState<TrackerConnectionInfo[] | null>(null);
  const [oauth, setOauth] = useState<OAuthOffered>({});
  const [trello, setTrello] = useState<TrelloOffer>({ key: null, authorizeUrl: null });
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [mapping, setMapping] = useState<string | null>(null);

  const load = useCallback(() => {
    api.trackerConnections(workspaceId).then(
      (r) => {
        setList(r.connections);
        setOauth(r.oauth);
        if (r.trello) setTrello(r.trello);
      },
      (e) => notify(errorText(e, 'Could not load tracker connections'), 'error'),
    );
  }, [workspaceId, notify]);
  useEffect(load, [load]);

  // Back from an OAuth consent: say how it went once.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('tracker_error');
    if (err) notify(err, 'error');
    else if (q.get('tracker_connected')) notify('Tracker connected', 'success');
  }, [notify]);

  const test = async (c: TrackerConnectionInfo) => {
    try {
      const r = await api.testTrackerConnection(c.id);
      setList((l) => l?.map((x) => (x.id === c.id ? r.connection : x)) ?? null);
      notify(`${c.name} works${r.account ? ` (as ${r.account})` : ''}`, 'success');
    } catch (e) {
      notify(errorText(e, `${c.name} didn’t answer`), 'error');
      load();
    }
  };
  const rotate = async (c: TrackerConnectionInfo) => {
    try {
      setSecret({ id: c.id, value: (await api.rotateTrackerWebhookSecret(c.id)).webhookSecret });
    } catch (e) {
      notify(errorText(e, 'Could not make a new secret'), 'error');
    }
  };
  const remove = async (c: TrackerConnectionInfo) => {
    if (!window.confirm(`Remove ${c.name}? Its ${c.links} linked issue${c.links === 1 ? '' : 's'} stop syncing; board items and issues stay as they are.`)) return;
    try {
      await api.deleteTrackerConnection(c.id);
      setList((l) => l?.filter((x) => x.id !== c.id) ?? null);
      notify(`Removed ${c.name}`, 'success');
    } catch (e) {
      notify(errorText(e, 'Could not remove it'), 'error');
    }
  };

  if (!list) return <Spinner />;
  return (
    <div className="fr-trackerconn">
      {list.length === 0 && !adding && <p className="fr-trackerconn__fine">No tracker connected yet.</p>}
      {list.map((c) => (
        <div key={c.id} className="fr-trackerconn__item" data-testid="tracker-connection">
          <div className="fr-trackerconn__head">
            <div>
              <div className="fr-trackerconn__name">
                {c.name}
                <span className={`fr-trackerconn__pill${c.status === 'active' ? '' : ' fr-trackerconn__pill--bad'}`}>{c.status === 'active' ? 'Active' : 'Needs attention'}</span>
              </div>
              <div className="fr-trackerconn__meta">
                {TRACKER_PROVIDERS[c.provider]}
                {c.deployment ? ` ${c.provider === 'azure' ? (c.deployment === 'cloud' ? 'Services' : 'Server') : c.deployment === 'cloud' ? 'Cloud' : 'Data Center'}` : ''} · {c.site} · {c.auth === 'oauth' ? 'OAuth' : 'token'}
                {c.account ? ` · as ${c.account}` : ''} · {c.links} linked issue{c.links === 1 ? '' : 's'} · added {relativeTime(c.createdAt)}
              </div>
              {c.lastError && <div className="fr-trackerconn__error">{c.lastError}</div>}
            </div>
            <div className="fr-trackerconn__buttons">
              <Button size="sm" icon={RefreshCw} onClick={() => void test(c)}>
                Test
              </Button>
              {c.fieldMap && c.provider !== 'linear' && c.provider !== 'github' && (
                <Button size="sm" variant="ghost" icon={ListTree} aria-expanded={mapping === c.id} onClick={() => setMapping(mapping === c.id ? null : c.id)}>
                  Field map
                </Button>
              )}
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(c)} aria-label={`Remove ${c.name}`}>
                Remove
              </Button>
            </div>
          </div>
          {SELF_HOOKED.has(c.provider) ? (
            <p className="fr-trackerconn__fine">
              {c.inbound === 'webhook'
                ? `Freero registers its own webhooks in ${TRACKER_PROVIDERS[c.provider]} for each ${PLACE[c.provider] ?? 'project'} you send to or import from, and polls as a fallback.`
                : `Polling every minute: nothing is registered in ${TRACKER_PROVIDERS[c.provider]}.`}
            </p>
          ) : (
            <div className="fr-trackerconn__webhook">
              <span>{c.inbound === 'webhook' ? 'Webhook address' : 'Polling every minute · webhook address (optional)'}</span>
              <code>{c.webhookUrl}</code>
              <Button size="sm" variant="ghost" onClick={() => void rotate(c)}>
                New secret
              </Button>
            </div>
          )}
          {c.provider === 'azure' && (
            <p className="fr-trackerconn__fine">
              In Azure DevOps: Project settings → Service hooks → Web Hooks, event “Work item updated”, this address, basic authentication with any user name and the webhook secret as the password.
            </p>
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
          trello={trello}
          onAdded={(c, s) => {
            setList((l) => [...(l ?? []), c]);
            // Nothing to paste where Freero registers its webhooks itself.
            if (!SELF_HOOKED.has(c.provider)) setSecret({ id: c.id, value: s });
            setAdding(false);
          }}
        />
      ) : (
        <Button icon={Plug} onClick={() => setAdding(true)}>
          Connect a tracker
        </Button>
      )}
    </div>
  );
}
