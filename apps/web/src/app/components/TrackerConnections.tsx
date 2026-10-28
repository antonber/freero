// Issue-tracker connections (KAI-153): a team's (admin console → Trackers, its owners/admins) or a
// person's own (Settings). Add one with an API token / personal access token, or OAuth where the
// server has an app for it; test it; see where the tracker should send webhooks (the secret is
// shown once, when made); remove it — sync stops, board items stay as they are. Tokens are sent
// once and never come back from the server.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, KeyRound, Plug, RefreshCw, Trash2 } from 'lucide-react';
import { TRACKER_PROVIDERS, type TrackerConnectionInfo, type TrackerConnectionInput, type TrackerProviderKind } from '@freero/shared';
import { Button, Input, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../api/client';
import { relativeTime } from '../lib/time';
import './TrackerConnections.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : e instanceof ApiError ? e.message || fallback : fallback);

const PROVIDER_OPTIONS = (Object.keys(TRACKER_PROVIDERS) as TrackerProviderKind[]).map((p) => ({ value: p, label: TRACKER_PROVIDERS[p] }));

const SITE_PLACEHOLDER: Record<TrackerProviderKind, string> = {
  jira: 'https://your-team.atlassian.net',
  linear: 'https://linear.app',
  github: 'https://github.com (or your GitHub Enterprise address)',
};
const TOKEN_LABEL: Record<TrackerProviderKind, string> = { jira: 'API token', linear: 'API key', github: 'Personal access token' };

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

function AddConnection({ workspaceId, oauthJira, onAdded }: { workspaceId: string | null; oauthJira: boolean; onAdded: (c: TrackerConnectionInfo, secret: string) => void }) {
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
      ...(provider === 'jira' ? { deployment } : {}),
      ...(provider === 'jira' && deployment === 'cloud' ? { email: email.trim() } : {}),
      ...(project.trim() ? { defaults: { project: project.trim() } } : {}),
    };
    try {
      const out = await api.createTrackerConnection(body);
      setToken('');
      onAdded(out.connection, out.webhookSecret);
      notify(`Connected ${out.connection.name}${out.connection.account ? ` as ${out.connection.account}` : ''}`, 'success');
    } catch (err) {
      setError(errorText(err, 'Could not connect the tracker'));
    } finally {
      setBusy(false);
    }
  };

  const oauthUrl = `/api/trackers/oauth/jira/start?${new URLSearchParams({ ...(workspaceId ? { workspace: workspaceId } : {}), name: name.trim() || 'Jira' })}`;
  return (
    <form className="fr-trackerconn__form" onSubmit={submit} aria-label="Connect a tracker">
      <div className="fr-trackerconn__grid">
        <label>
          <span>Tracker</span>
          <Select aria-label="Tracker" options={PROVIDER_OPTIONS} value={provider} onChange={setProvider} width="100%" />
        </label>
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
        <Input label="Address" value={site} placeholder={SITE_PLACEHOLDER[provider]} onChange={(e) => setSite(e.target.value)} required={provider === 'jira'} />
        {provider === 'jira' && deployment === 'cloud' && (
          <Input label="Account email" type="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} required />
        )}
        <Input
          label={provider === 'jira' && deployment === 'datacenter' ? 'Personal access token' : TOKEN_LABEL[provider]}
          type="password"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
          required
        />
        <Input label={provider === 'github' ? 'Default repository (owner/name)' : provider === 'linear' ? 'Default team key' : 'Default project key'} value={project} onChange={(e) => setProject(e.target.value)} />
        <label>
          <span>Changes from the tracker</span>
          <Select
            aria-label="Changes from the tracker"
            options={[
              { value: 'webhook', label: 'Webhooks', description: 'Instant; the tracker must reach this server' },
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
        {provider === 'jira' && deployment === 'cloud' && oauthJira && (
          <Button type="button" icon={KeyRound} onClick={() => window.location.assign(oauthUrl)}>
            Connect with Atlassian instead
          </Button>
        )}
      </div>
      <p className="fr-trackerconn__fine">
        Freero tests the token right away and keeps it encrypted; it is never shown again. Issues are created as that account.
      </p>
    </form>
  );
}

export function TrackerConnections({ workspaceId }: { workspaceId: string | null }) {
  const notify = useToast();
  const [list, setList] = useState<TrackerConnectionInfo[] | null>(null);
  const [oauthJira, setOauthJira] = useState(false);
  const [secret, setSecret] = useState<{ id: string; value: string } | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    api.trackerConnections(workspaceId).then(
      (r) => {
        setList(r.connections);
        setOauthJira(r.oauth.jira);
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
                {c.deployment ? ` ${c.deployment === 'cloud' ? 'Cloud' : 'Data Center'}` : ''} · {c.site} · {c.auth === 'oauth' ? 'OAuth' : 'token'}
                {c.account ? ` · as ${c.account}` : ''} · {c.links} linked issue{c.links === 1 ? '' : 's'} · added {relativeTime(c.createdAt)}
              </div>
              {c.lastError && <div className="fr-trackerconn__error">{c.lastError}</div>}
            </div>
            <div className="fr-trackerconn__buttons">
              <Button size="sm" icon={RefreshCw} onClick={() => void test(c)}>
                Test
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void remove(c)} aria-label={`Remove ${c.name}`}>
                Remove
              </Button>
            </div>
          </div>
          <div className="fr-trackerconn__webhook">
            <span>{c.inbound === 'webhook' ? 'Webhook address' : 'Polling every minute · webhook address (optional)'}</span>
            <code>{c.webhookUrl}</code>
            <Button size="sm" variant="ghost" onClick={() => void rotate(c)}>
              New secret
            </Button>
          </div>
          {secret?.id === c.id && <Secret value={secret.value} onDone={() => setSecret(null)} />}
        </div>
      ))}
      {adding ? (
        <AddConnection
          workspaceId={workspaceId}
          oauthJira={oauthJira}
          onAdded={(c, s) => {
            setList((l) => [...(l ?? []), c]);
            setSecret({ id: c.id, value: s });
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
