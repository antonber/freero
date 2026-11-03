// The admin console's audit streams (#17), on the Audit log tab: the workspace's audit log sent to
// its SIEM — Splunk (HTTP Event Collector), Microsoft Sentinel (Logs Ingestion API), any HTTPS
// collector (signed like webhooks) or syslog over TLS. Shown only when the server offers it. The
// server keeps every secret; this page only ever sends them, and shows the signing secret once.
import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Pause, Play, Plus, Send, Trash2 } from 'lucide-react';
import type { SiemKind, SiemSettings, SiemSinkInfo, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, SegmentedControl, TextArea, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import './siem.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

const KINDS: Array<{ value: SiemKind; label: string }> = [
  { value: 'splunk', label: 'Splunk' },
  { value: 'sentinel', label: 'Microsoft Sentinel' },
  { value: 'https', label: 'HTTPS' },
  { value: 'syslog', label: 'Syslog (TLS)' },
];
const kindLabel = (k: SiemKind) => KINDS.find((x) => x.value === k)?.label ?? k;

/** Whether this server streams audit logs (the list answers 404 when it doesn't). */
export async function siemOffered(workspaceId: string): Promise<boolean> {
  return api.siemSinks(workspaceId).then(
    () => true,
    () => false,
  );
}

interface Draft {
  kind: SiemKind;
  name: string;
  settings: Record<string, string>;
  secret: string;
}
const EMPTY: Draft = { kind: 'splunk', name: '', settings: {}, secret: '' };

function settingsOf(d: Draft): SiemSettings {
  const s = d.settings;
  const t = (k: string) => (s[k]?.trim() ? s[k].trim() : undefined);
  if (d.kind === 'splunk') return { url: t('url'), index: t('index'), sourcetype: t('sourcetype') };
  if (d.kind === 'sentinel') return { endpoint: t('endpoint'), dcrId: t('dcrId'), stream: t('stream'), tenantId: t('tenantId'), clientId: t('clientId') };
  if (d.kind === 'https') return { url: t('url') };
  return { host: t('host'), port: t('port') ? Number(t('port')) : undefined, caCert: t('caCert') };
}

function SinkForm({ busy, onSubmit, onCancel }: { busy: boolean; onSubmit: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(EMPTY);
  const set = (k: string) => (e: { target: { value: string } }) => setD((x) => ({ ...x, settings: { ...x.settings, [k]: e.target.value } }));
  const v = (k: string) => d.settings[k] ?? '';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(d);
  };
  return (
    <form className="fr-admin-siem__form" onSubmit={submit}>
      <SegmentedControl<SiemKind> aria-label="Where to" options={KINDS} value={d.kind} onChange={(kind) => setD({ ...EMPTY, kind })} />
      <Input label="Name" value={d.name} onChange={(e) => setD((x) => ({ ...x, name: e.target.value }))} placeholder={kindLabel(d.kind)} />
      {d.kind === 'splunk' ? (
        <>
          <Input label="HTTP Event Collector URL" value={v('url')} onChange={set('url')} placeholder="https://splunk.example.com:8088" />
          <Input label="HEC token" type="password" value={d.secret} onChange={(e) => setD((x) => ({ ...x, secret: e.target.value }))} />
          <div className="fr-admin-siem__pair">
            <Input label="Index (optional)" value={v('index')} onChange={set('index')} />
            <Input label="Source type (optional)" value={v('sourcetype')} onChange={set('sourcetype')} placeholder="freero:audit" />
          </div>
        </>
      ) : d.kind === 'sentinel' ? (
        <>
          <Input label="Data collection endpoint" value={v('endpoint')} onChange={set('endpoint')} placeholder="https://….ingest.monitor.azure.com" />
          <div className="fr-admin-siem__pair">
            <Input label="Data collection rule ID" value={v('dcrId')} onChange={set('dcrId')} placeholder="dcr-…" />
            <Input label="Stream" value={v('stream')} onChange={set('stream')} placeholder="Custom-FreeroAudit_CL" />
          </div>
          <div className="fr-admin-siem__pair">
            <Input label="Directory (tenant) ID" value={v('tenantId')} onChange={set('tenantId')} />
            <Input label="Application (client) ID" value={v('clientId')} onChange={set('clientId')} />
          </div>
          <Input label="Client secret" type="password" value={d.secret} onChange={(e) => setD((x) => ({ ...x, secret: e.target.value }))} />
        </>
      ) : d.kind === 'https' ? (
        <>
          <Input label="Collector URL" value={v('url')} onChange={set('url')} placeholder="https://collector.example.com/freero" />
          <Input
            label="Bearer token (optional)"
            type="password"
            value={d.secret}
            onChange={(e) => setD((x) => ({ ...x, secret: e.target.value }))}
            hint="Sent as Authorization: Bearer. Every request is also signed with a secret you get once you add the stream."
          />
        </>
      ) : (
        <>
          <div className="fr-admin-siem__pair">
            <Input label="Host" value={v('host')} onChange={set('host')} placeholder="syslog.example.com" />
            <Input label="Port" value={v('port')} onChange={set('port')} placeholder="6514" inputMode="numeric" />
          </div>
          <TextArea label="CA certificate (optional, PEM)" rows={3} value={v('caCert')} onChange={set('caCert')} placeholder="-----BEGIN CERTIFICATE-----" />
        </>
      )}
      <div className="fr-admin-siem__actions">
        <Button type="submit" variant="primary" loading={busy}>
          Start streaming
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  );
}

export function AdminSiem({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [sinks, setSinks] = useState<SiemSinkInfo[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const reload = () => api.siemSinks(workspace.id).then(({ sinks }) => setSinks(sinks), () => setSinks([]));
  useEffect(() => {
    void reload();
    const t = window.setInterval(() => void reload(), 15_000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace.id]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try {
      await fn();
      if (ok) notify(ok, 'success');
      await reload();
    } catch (e) {
      notify(errorText(e, 'That didn’t work'), 'error');
    } finally {
      setBusy(null);
    }
  };

  if (!sinks) return null;
  return (
    <div className="fr-admin-card fr-admin-siem">
      <div className="fr-admin-row">
        <div className="fr-admin-row__text">
          <span className="fr-admin-row__label">Stream to your SIEM</span>
          <span className="fr-admin-row__hint">
            Every new event of this log goes to Splunk, Microsoft Sentinel, an HTTPS collector or syslog over TLS, in order and retried until it arrives. Each
            carries its place in the hash chain, and every hour a signed checkpoint of the newest event follows, so your SIEM holds its own copy of the chain.
          </span>
        </div>
        {!adding ? (
          <div className="fr-admin-row__control">
            <Button icon={Plus} onClick={() => setAdding(true)}>
              Add a stream
            </Button>
          </div>
        ) : null}
      </div>
      {adding ? (
        <SinkForm
          busy={busy === 'add'}
          onCancel={() => setAdding(false)}
          onSubmit={(d) =>
            void run('add', async () => {
              const r = await api.createSiemSink(workspace.id, { kind: d.kind, name: d.name || undefined, settings: settingsOf(d), secret: d.secret || undefined });
              setAdding(false);
              if (r.signingSecret) setSecret(r.signingSecret);
              else notify('Streaming started', 'success');
            })
          }
        />
      ) : null}
      {sinks.length ? (
        <ul className="fr-admin-siem__list">
          {sinks.map((s) => {
            const behind = Math.max(0, s.headSeq - s.deliveredSeq);
            return (
              <li key={s.id} className="fr-admin-siem__sink">
                <div className="fr-admin-siem__head">
                  <strong>{s.name}</strong>
                  <span className="fr-admin-row__hint">
                    {kindLabel(s.kind)} · <code>{s.target}</code>
                  </span>
                  <span className="fr-admin-siem__spacer" />
                  {s.status === 'ok' ? (
                    <span className="fr-admin-pill fr-admin-pill--ok">{behind ? `Sending · ${behind} to go` : 'Up to date'}</span>
                  ) : s.status === 'failing' ? (
                    <span className="fr-admin-pill fr-admin-pill--warn">Retrying · {behind} waiting</span>
                  ) : (
                    <span className="fr-admin-pill fr-admin-pill--off">Paused</span>
                  )}
                </div>
                <span className="fr-admin-row__hint">
                  {s.lastDeliveredAt ? `Last delivery ${new Date(s.lastDeliveredAt).toLocaleString()}.` : 'Nothing delivered yet.'}
                  {s.lastError ? ` Last attempt failed: ${s.lastError}.` : ''}
                  {s.status === 'failing' && s.nextAttemptAt ? ` Next try ${new Date(s.nextAttemptAt).toLocaleTimeString()}.` : ''}
                </span>
                <div className="fr-admin-siem__actions">
                  <Button size="sm" icon={Send} loading={busy === `test-${s.id}`} onClick={() => void run(`test-${s.id}`, () => api.testSiemSink(workspace.id, s.id), 'Test record sent')}>
                    Send test
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={s.enabled ? Pause : Play}
                    onClick={() => void run(`pause-${s.id}`, () => api.updateSiemSink(workspace.id, s.id, { enabled: !s.enabled }))}
                  >
                    {s.enabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button size="sm" variant="ghost" icon={Trash2} onClick={() => void run(`rm-${s.id}`, () => api.deleteSiemSink(workspace.id, s.id), 'Stream removed')}>
                    Remove
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title="Streaming started"
        width={480}
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>
            Done
          </Button>
        }
      >
        <p className="fr-admin-siem__modal-text">
          Copy the signing secret now — it won’t be shown again. Each request carries <code>Freero-Signature: t=…,v1=…</code>, the HMAC-SHA256 of{' '}
          <code>t.body</code> with this secret.
        </p>
        {secret ? (
          <div className="fr-admin-siem__secret">
            <code>{secret}</code>
            <Button
              size="sm"
              variant="ghost"
              icon={Copy}
              onClick={() => void navigator.clipboard?.writeText(secret).then(() => notify('Copied', 'success'), () => notify('Could not copy', 'error'))}
            >
              Copy
            </Button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
