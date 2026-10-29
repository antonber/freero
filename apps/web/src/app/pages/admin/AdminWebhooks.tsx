// Webhooks (KAI-105): send what happens on this workspace's boards to other tools — a service of
// your own (signed JSON), a Slack or Microsoft Teams channel (a ready-made message). Owners and
// admins add endpoints, choose events, send a test, rotate the signing secret and read each
// endpoint's delivery log. The server checks every action again, audits changes, and only ever
// sends events about boards everyone in the workspace can open.
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Copy, Pencil, Plus, RefreshCw, RotateCw, ScrollText, Send, Trash2 } from 'lucide-react';
import {
  EVENT_TYPES,
  type FreeroEventType,
  type WebhookDeliveryInfo,
  type WebhookEndpointInfo,
  type WebhookFormat,
  type WorkspaceSummary,
} from '@freero/shared';
import { Button, Input, Modal, Select, Spinner, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import './webhooks.css';

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);

/** Whether this server offers webhooks at all (the tab shows only then). */
export async function webhooksOffered(workspaceId: string): Promise<boolean> {
  return api.webhooks(workspaceId).then(
    () => true,
    () => false,
  );
}

const FORMATS: SelectOption<WebhookFormat>[] = [
  { value: 'json', label: 'JSON (signed, for your own service)' },
  { value: 'slack', label: 'Slack message (incoming webhook)' },
  { value: 'teams', label: 'Microsoft Teams message (Workflows webhook)' },
];
const FORMAT_LABEL: Record<WebhookFormat, string> = { json: 'JSON', slack: 'Slack', teams: 'Teams' };
const GROUPS: Array<{ label: string; types: FreeroEventType[] }> = [
  { label: 'Items', types: ['item.created', 'item.updated', 'item.deleted'] },
  { label: 'Comments', types: ['comment.created'] },
  { label: 'Boards', types: ['board.created', 'board.renamed', 'board.moved', 'board.trashed', 'board.restored'] },
  { label: 'Sharing', types: ['member.added', 'member.role_changed', 'member.removed'] },
];
const DEFAULT_EVENTS: FreeroEventType[] = ['item.created', 'comment.created'];

function CopySecret({ value }: { value: string }) {
  const notify = useToast();
  return (
    <div className="fr-admin-hooks__secret">
      <code>{value}</code>
      <Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard?.writeText(value).then(() => notify('Copied', 'success'), () => notify('Could not copy', 'error'))}>
        Copy
      </Button>
    </div>
  );
}

interface Draft {
  url: string;
  description: string;
  format: WebhookFormat;
  events: FreeroEventType[];
  /** A board or item link ('' = every board), KAI-249. */
  scope: string;
}

/** An endpoint's scope as an address the form shows and sends back unchanged. */
const scopeAddress = (s: WebhookEndpointInfo['scope']): string => (s ? `freero://board/${s.boardId}${s.itemId ? `#${s.itemId}` : ''}` : '');

function EndpointForm({ initial, editing, busy, onSubmit, onCancel }: { initial: Draft; editing: boolean; busy: boolean; onSubmit: (d: Draft) => void; onCancel: () => void }) {
  const [d, setD] = useState(initial);
  const toggle = (t: FreeroEventType, on: boolean) => setD((x) => ({ ...x, events: on ? [...new Set([...x.events, t])] : x.events.filter((e) => e !== t) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(d);
  };
  return (
    <form className="fr-admin-hooks__form" onSubmit={submit}>
      <Input
        label="Endpoint URL"
        placeholder="https://"
        value={d.url}
        onChange={(e) => setD({ ...d, url: e.target.value })}
        hint={editing ? 'Leave empty to keep the current URL (only its start is shown, the rest may be a token).' : 'Freero sends a POST for every event you pick.'}
        autoFocus
        required={!editing}
      />
      <Input label="Description (optional)" value={d.description} maxLength={200} onChange={(e) => setD({ ...d, description: e.target.value })} />
      <Input
        label="Only for (optional)"
        placeholder="Paste a board link, or an item's copied link"
        value={d.scope}
        maxLength={2048}
        onChange={(e) => setD({ ...d, scope: e.target.value })}
        hint="Empty: every board the whole team can open. A board: only its events. An item (a frame, or an agent's Tasks kanban): only changes and comments on it and what sits in it."
      />
      <label className="fr-admin-hooks__field">
        <span className="fr-admin-row__label">Format</span>
        <Select<WebhookFormat> aria-label="Format" value={d.format} onChange={(format) => setD({ ...d, format })} options={FORMATS} />
      </label>
      <fieldset className="fr-admin-hooks__events">
        <legend className="fr-admin-row__label">Events</legend>
        {GROUPS.map((g) => (
          <div key={g.label} className="fr-admin-hooks__group">
            <span className="fr-admin-hooks__group-label">{g.label}</span>
            {g.types.map((t) => (
              <label key={t} className="fr-admin-hooks__check">
                <input type="checkbox" checked={d.events.includes(t)} onChange={(e) => toggle(t, e.target.checked)} />
                <code>{t}</code>
                <span className="fr-admin__muted">{EVENT_TYPES[t]}</span>
              </label>
            ))}
          </div>
        ))}
      </fieldset>
      <div className="fr-admin-hooks__form-actions">
        <Button variant="ghost" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!d.events.length || (!editing && !d.url.trim())}>
          {editing ? 'Save' : 'Add webhook'}
        </Button>
      </div>
    </form>
  );
}

const STATUS_PILL: Record<WebhookDeliveryInfo['status'], string> = { delivered: 'fr-admin-pill--ok', pending: 'fr-admin-pill--warn', failed: 'fr-admin-pill--off' };

function DeliveryLog({ workspaceId, endpoint }: { workspaceId: string; endpoint: WebhookEndpointInfo }) {
  const notify = useToast();
  const [list, setList] = useState<WebhookDeliveryInfo[] | null>(null);
  const load = useCallback(() => {
    api.webhookDeliveries(workspaceId, endpoint.id).then(
      (r) => setList(r.deliveries),
      (e) => notify(errorText(e, 'Could not load the delivery log'), 'error'),
    );
  }, [workspaceId, endpoint.id, notify]);
  useEffect(() => {
    load();
    // Pending deliveries change on their own: follow them while the log is open.
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [load]);
  const redeliver = async (d: WebhookDeliveryInfo) => {
    try {
      await api.redeliverWebhook(workspaceId, endpoint.id, d.id);
      notify('Sending it again', 'success');
      load();
    } catch (e) {
      notify(errorText(e, 'Could not send it again'), 'error');
    }
  };
  if (!list) return <Spinner size={18} />;
  if (!list.length) return <p className="fr-admin__muted fr-admin-hooks__empty-log">Nothing sent yet. Send a test, or wait for the next event.</p>;
  const now = Date.now();
  return (
    <div className="fr-admin-table-wrap">
      <table className="fr-admin-table fr-admin-hooks__log" aria-label="Delivery log">
        <thead>
          <tr>
            <th>Event</th>
            <th>Status</th>
            <th>Attempts</th>
            <th>Answer</th>
            <th>When</th>
            <th>
              <span className="fr-admin__sr">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id} data-testid="webhook-delivery">
              <td>
                {d.eventType === 'ping' ? <span>Test</span> : <code>{d.eventType}</code>}
                {d.eventType === 'ping' ? null : <div className="fr-admin__muted fr-admin-hooks__id">{d.eventId}</div>}
              </td>
              <td>
                <span className={`fr-admin-pill ${STATUS_PILL[d.status]}`}>{d.status === 'delivered' ? 'Delivered' : d.status === 'failed' ? 'Failed' : 'Retrying'}</span>
                {d.status === 'pending' && d.nextAttemptAt ? <div className="fr-admin__muted fr-admin-hooks__id">next {d.nextAttemptAt <= now ? 'now' : `in ${Math.ceil((d.nextAttemptAt - now) / 1000)} s`}</div> : null}
              </td>
              <td>{d.attempts}</td>
              <td className="fr-admin-hooks__answer">
                {d.responseStatus !== null ? <code>{d.responseStatus}</code> : null}
                {d.error ? <span className="fr-admin__muted"> {d.error}</span> : null}
                {d.durationMs !== null && d.status === 'delivered' ? <span className="fr-admin__muted"> · {d.durationMs} ms</span> : null}
              </td>
              <td className="fr-admin__muted fr-admin__nowrap">{relativeTime(d.deliveredAt ?? d.createdAt, now)}</td>
              <td className="fr-admin-table__actions">
                {d.status !== 'delivered' ? (
                  <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => void redeliver(d)}>
                    Send again
                  </Button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminWebhooks({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [endpoints, setEndpoints] = useState<WebhookEndpointInfo[] | null>(null);
  const [form, setForm] = useState<{ edit: WebhookEndpointInfo | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ value: string; rotated: boolean } | null>(null);
  const [log, setLog] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<WebhookEndpointInfo | null>(null);

  const load = useCallback(() => {
    api.webhooks(workspace.id).then(
      (r) => setEndpoints(r.endpoints),
      (e) => notify(errorText(e, 'Could not load webhooks'), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);
  const replace = (e: WebhookEndpointInfo) => setEndpoints((list) => (list ?? []).map((x) => (x.id === e.id ? e : x)));

  const save = async (d: Draft) => {
    setBusy(true);
    try {
      if (form?.edit) {
        const { endpoint } = await api.updateWebhook(workspace.id, form.edit.id, {
          ...(d.url.trim() ? { url: d.url.trim() } : {}),
          description: d.description,
          format: d.format,
          events: d.events,
          ...(d.scope.trim() !== scopeAddress(form.edit.scope) ? { scope: d.scope.trim() || null } : {}),
        });
        replace(endpoint);
        notify('Webhook saved', 'success');
      } else {
        const r = await api.createWebhook(workspace.id, { url: d.url.trim(), description: d.description, format: d.format, events: d.events, ...(d.scope.trim() ? { scope: d.scope.trim() } : {}) });
        setEndpoints((list) => [...(list ?? []), r.endpoint]);
        setSecret({ value: r.secret, rotated: false });
      }
      setForm(null);
    } catch (e) {
      notify(errorText(e, 'Could not save the webhook'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const setEnabled = async (e: WebhookEndpointInfo, enabled: boolean) => {
    try {
      replace((await api.updateWebhook(workspace.id, e.id, { enabled })).endpoint);
      notify(enabled ? 'Webhook on: waiting deliveries are sent again' : 'Webhook off: nothing is sent until you turn it back on', 'success');
    } catch (err) {
      notify(errorText(err, 'Could not change the webhook'), 'error');
    }
  };
  const test = async (e: WebhookEndpointInfo) => {
    try {
      await api.testWebhook(workspace.id, e.id);
      notify('Test sent — see the delivery log', 'success');
      setLog(e.id);
    } catch (err) {
      notify(errorText(err, 'Could not send a test'), 'error');
    }
  };
  const rotate = async (e: WebhookEndpointInfo) => {
    try {
      const r = await api.rotateWebhookSecret(workspace.id, e.id);
      replace(r.endpoint);
      setSecret({ value: r.secret, rotated: true });
    } catch (err) {
      notify(errorText(err, 'Could not rotate the secret'), 'error');
    }
  };
  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteWebhook(workspace.id, deleting.id);
      setEndpoints((list) => (list ?? []).filter((x) => x.id !== deleting.id));
      notify('Webhook removed', 'success');
    } catch (err) {
      notify(errorText(err, 'Could not remove the webhook'), 'error');
    } finally {
      setDeleting(null);
    }
  };

  if (!endpoints) return <Spinner />;
  const now = Date.now();
  return (
    <section aria-labelledby="admin-hooks-title">
      <div className="fr-admin-hooks__head">
        <h1 id="admin-hooks-title" className="fr-admin__title">
          Webhooks
        </h1>
        <Button variant="primary" icon={Plus} onClick={() => setForm({ edit: null })}>
          Add webhook
        </Button>
      </div>
      <p className="fr-admin__intro">
        Send what happens on this workspace’s boards to other tools: your own service (signed JSON) or a Slack or Microsoft Teams channel. Only
        boards everyone in the workspace can open are ever sent — never personal boards, private projects, private drafts or hidden frames.
        Failed deliveries are retried with growing gaps for a few hours; a webhook that keeps failing is turned off and its creator is emailed.
      </p>

      {endpoints.length === 0 ? (
        <div className="fr-admin-card fr-admin-hooks__none">
          <p className="fr-admin__muted">No webhooks yet.</p>
        </div>
      ) : (
        endpoints.map((e) => (
          <div key={e.id} className={`fr-admin-card fr-admin-hooks__item${e.enabled ? '' : ' fr-admin-hooks__item--off'}`} data-testid="webhook">
            <div className="fr-admin-hooks__top">
              <div className="fr-admin-hooks__what">
                <code className="fr-admin-hooks__url">{e.url}</code>
                <span className="fr-admin-pill fr-admin-pill--ok">{FORMAT_LABEL[e.format]}</span>
                {!e.enabled ? <span className="fr-admin-pill fr-admin-pill--off">{e.disabledReason ? 'Turned off' : 'Off'}</span> : null}
                {e.description ? <div className="fr-admin-hooks__desc">{e.description}</div> : null}
                {e.scope ? (
                  <div className="fr-admin-hooks__desc">
                    Only {e.scope.itemId ? 'one item on ' : ''}“{e.scope.boardTitle ?? 'a board that is gone'}”
                  </div>
                ) : null}
              </div>
              <Toggle aria-label={`Send to ${e.url}`} checked={e.enabled} onChange={(on) => void setEnabled(e, on)} />
            </div>
            {e.disabledReason ? <p className="fr-admin-hooks__warning">{e.disabledReason}. Fix the receiver, then turn it back on.</p> : null}
            <div className="fr-admin-hooks__events-list">
              {e.events.map((t) => (
                <code key={t}>{t}</code>
              ))}
            </div>
            <div className="fr-admin-hooks__meta fr-admin__muted">
              Added {relativeTime(e.createdAt, now)}
              {e.createdBy ? ` by ${e.createdBy.name}` : ''} · {e.lastDeliveryAt ? `last delivered ${relativeTime(e.lastDeliveryAt, now)}` : 'nothing delivered yet'}
              {e.consecutiveFailures > 0 && e.enabled ? ` · ${e.consecutiveFailures} failed in a row` : ''}
            </div>
            <div className="fr-admin-hooks__actions">
              <Button size="sm" variant="secondary" icon={Send} onClick={() => void test(e)} disabled={!e.enabled}>
                Send test
              </Button>
              <Button size="sm" variant="ghost" icon={ScrollText} onClick={() => setLog(log === e.id ? null : e.id)} aria-expanded={log === e.id}>
                Delivery log
              </Button>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ edit: e })}>
                Edit
              </Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void rotate(e)}>
                Rotate secret
              </Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleting(e)}>
                Remove
              </Button>
            </div>
            {log === e.id ? <DeliveryLog workspaceId={workspace.id} endpoint={e} /> : null}
          </div>
        ))
      )}
      <p className="fr-admin__muted">
        Each JSON delivery carries a <code>Freero-Signature</code> header: <code>t=&lt;unix seconds&gt;,v1=&lt;HMAC-SHA256 of “t.body”&gt;</code> with the
        webhook’s secret. Check it, and refuse old timestamps.
      </p>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.edit ? 'Edit webhook' : 'Add a webhook'} width={620}>
        {form ? (
          <EndpointForm
            key={form.edit?.id ?? 'new'}
            editing={!!form.edit}
            busy={busy}
            initial={form.edit ? { url: '', description: form.edit.description, format: form.edit.format, events: form.edit.events, scope: scopeAddress(form.edit.scope) } : { url: '', description: '', format: 'json', events: DEFAULT_EVENTS, scope: '' }}
            onSubmit={(d) => void save(d)}
            onCancel={() => setForm(null)}
          />
        ) : null}
      </Modal>

      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={secret?.rotated ? 'The new signing secret' : 'Webhook added'}
        width={520}
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>
            Done
          </Button>
        }
      >
        <p className="fr-admin-hooks__modal-text">
          {secret?.rotated ? 'Deliveries are signed with this secret from now on. ' : ''}Copy the signing secret now — it won’t be shown again. Use it to
          check that deliveries come from Freero.
        </p>
        {secret ? <CopySecret value={secret.value} /> : null}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title="Remove this webhook?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Remove
            </Button>
          </>
        }
      >
        <p className="fr-admin-hooks__modal-text">Nothing more is sent to {deleting?.url}, and its delivery log goes with it.</p>
      </Modal>
    </section>
  );
}
