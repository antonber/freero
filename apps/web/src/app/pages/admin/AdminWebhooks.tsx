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
  type ProjectSummary,
  type WebhookDeliveryInfo,
  type WebhookEndpointInfo,
  type WebhookFormat,
  type WorkspaceSummary,
} from '@freero/shared';
import { Button, Input, Modal, Select, Spinner, Toggle, useToast, type SelectOption } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { t as tr } from './messages';
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
  { value: 'json', label: tr('jsonSignedForYourOwn') },
  { value: 'slack', label: tr('slackMessageIncomingWebhook') },
  { value: 'teams', label: tr('microsoftTeamsMessageWorkflowsWebhook') },
  { value: 'discord', label: tr('discordMessageChannelWebhook') },
  { value: 'google-chat', label: tr('googleChatMessageSpaceWebhook') },
  { value: 'mattermost', label: tr('mattermostMessageIncomingWebhook') },
];
const FORMAT_LABEL: Record<WebhookFormat, string> = { json: 'JSON', slack: 'Slack', teams: 'Teams', discord: 'Discord', 'google-chat': 'Google Chat', mattermost: 'Mattermost' };
const GROUPS: Array<{ label: string; types: FreeroEventType[] }> = [
  { label: tr('items'), types: ['item.created', 'item.updated', 'item.deleted'] },
  { label: tr('comments'), types: ['comment.created'] },
  { label: tr('boards'), types: ['board.created', 'board.renamed', 'board.moved', 'board.trashed', 'board.restored'] },
  { label: tr('sharing'), types: ['member.added', 'member.role_changed', 'member.removed'] },
];
const DEFAULT_EVENTS: FreeroEventType[] = ['item.created', 'comment.created'];

function CopySecret({ value }: { value: string }) {
  const notify = useToast();
  return (
    <div className="fr-admin-hooks__secret">
      <code>{value}</code>
      <Button size="sm" variant="ghost" icon={Copy} onClick={() => void navigator.clipboard?.writeText(value).then(() => notify(tr('copied'), 'success'), () => notify(tr('couldNotCopy'), 'error'))}>{tr('copy')}</Button>
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
  /** Only this project's boards ('' = no project filter), #48. */
  projectId: string;
}

/** An endpoint's scope as an address the form shows and sends back unchanged. */
const scopeAddress = (s: WebhookEndpointInfo['scope']): string => (s ? `freero://board/${s.boardId}${s.itemId ? `#${s.itemId}` : ''}` : '');

function EndpointForm({
  initial,
  editing,
  busy,
  projects,
  onSubmit,
  onCancel,
}: {
  initial: Draft;
  editing: boolean;
  busy: boolean;
  projects: ProjectSummary[];
  onSubmit: (d: Draft) => void;
  onCancel: () => void;
}) {
  const projectOptions: SelectOption<string>[] = [{ value: '', label: tr('everyProject') }, ...projects.map((p) => ({ value: p.id, label: p.name }))];
  const [d, setD] = useState(initial);
  const toggle = (t: FreeroEventType, on: boolean) => setD((x) => ({ ...x, events: on ? [...new Set([...x.events, t])] : x.events.filter((e) => e !== t) }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(d);
  };
  return (
    <form className="fr-admin-hooks__form" onSubmit={submit}>
      <Input
        label={tr('endpointUrl')}
        placeholder="https://"
        value={d.url}
        onChange={(e) => setD({ ...d, url: e.target.value })}
        hint={editing ? tr('leaveEmptyToKeepThe') : tr('freeroSendsAPostFor')}
        autoFocus
        required={!editing}
      />
      <Input label={tr('descriptionOptional')} value={d.description} maxLength={200} onChange={(e) => setD({ ...d, description: e.target.value })} />
      <Input
        label={tr('onlyForOptional')}
        placeholder={tr('pasteABoardLinkOr')}
        value={d.scope}
        maxLength={2048}
        onChange={(e) => setD({ ...d, scope: e.target.value })}
        hint={tr('emptyEveryBoardTheWhole')}
      />
      {projects.length && !d.scope.trim() ? (
        <label className="fr-admin-hooks__field">
          <span className="fr-admin-row__label">{tr('project')}</span>
          <Select<string> aria-label={tr('project')} value={d.projectId} onChange={(projectId) => setD({ ...d, projectId })} options={projectOptions} />
        </label>
      ) : null}
      <label className="fr-admin-hooks__field">
        <span className="fr-admin-row__label">{tr('format')}</span>
        <Select<WebhookFormat> aria-label={tr('format')} value={d.format} onChange={(format) => setD({ ...d, format })} options={FORMATS} />
      </label>
      <fieldset className="fr-admin-hooks__events">
        <legend className="fr-admin-row__label">{tr('events')}</legend>
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
        <Button variant="ghost" type="button" onClick={onCancel}>{tr('cancel')}</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!d.events.length || (!editing && !d.url.trim())}>
          {editing ? tr('save') : tr('addWebhook')}
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
      (e) => notify(errorText(e, tr('couldNotLoadTheDelivery')), 'error'),
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
      notify(tr('sendingItAgain'), 'success');
      load();
    } catch (e) {
      notify(errorText(e, tr('couldNotSendItAgain')), 'error');
    }
  };
  if (!list) return <Spinner size={18} />;
  if (!list.length) return <p className="fr-admin__muted fr-admin-hooks__empty-log">{tr('nothingSentYetSendA')}</p>;
  const now = Date.now();
  return (
    <div className="fr-admin-table-wrap">
      <table className="fr-admin-table fr-admin-hooks__log" aria-label={tr('deliveryLog')}>
        <thead>
          <tr>
            <th>{tr('event')}</th>
            <th>{tr('status')}</th>
            <th>{tr('attempts')}</th>
            <th>{tr('answer')}</th>
            <th>{tr('when')}</th>
            <th>
              <span className="fr-admin__sr">{tr('actions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.map((d) => (
            <tr key={d.id} data-testid="webhook-delivery">
              <td>
                {d.eventType === 'ping' ? <span>{tr('test')}</span> : <code>{d.eventType}</code>}
                {d.eventType === 'ping' ? null : <div className="fr-admin__muted fr-admin-hooks__id">{d.eventId}</div>}
              </td>
              <td>
                <span className={`fr-admin-pill ${STATUS_PILL[d.status]}`}>{d.status === 'delivered' ? tr('delivered') : d.status === 'failed' ? tr('failed') : tr('retrying')}</span>
                {d.status === 'pending' && d.nextAttemptAt ? <div className="fr-admin__muted fr-admin-hooks__id">{tr('next')}{' '}{d.nextAttemptAt <= now ? 'now' : tr('inCeilS', { ceil: Math.ceil((d.nextAttemptAt - now) / 1000) })}</div> : null}
              </td>
              <td>{d.attempts}</td>
              <td className="fr-admin-hooks__answer">
                {d.responseStatus !== null ? <code>{d.responseStatus}</code> : null}
                {d.error ? <span className="fr-admin__muted"> {d.error}</span> : null}
                {d.durationMs !== null && d.status === 'delivered' ? <span className="fr-admin__muted">{' '}{tr('durationmsMs', { durationMs: d.durationMs })}</span> : null}
              </td>
              <td className="fr-admin__muted fr-admin__nowrap">{relativeTime(d.deliveredAt ?? d.createdAt, now)}</td>
              <td className="fr-admin-table__actions">
                {d.status !== 'delivered' ? (
                  <Button size="sm" variant="ghost" icon={RotateCw} onClick={() => void redeliver(d)}>{tr('sendAgain')}</Button>
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
  // Projects the whole team can open: the only ones a webhook may be limited to (#48).
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  useEffect(() => {
    api.listProjects(workspace.id).then(
      (r) => setProjects(r.projects.filter((p) => p.access === 'workspace')),
      () => setProjects([]),
    );
  }, [workspace.id]);
  const projectName = (id: string) => projects.find((p) => p.id === id)?.name ?? 'a project';

  const load = useCallback(() => {
    api.webhooks(workspace.id).then(
      (r) => setEndpoints(r.endpoints),
      (e) => notify(errorText(e, tr('couldNotLoadWebhooks')), 'error'),
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
          // A board or item scope replaces a project filter.
          ...((d.scope.trim() ? '' : d.projectId) !== (form.edit.projectId ?? '') ? { projectId: (d.scope.trim() ? '' : d.projectId) || null } : {}),
        });
        replace(endpoint);
        notify(tr('webhookSaved'), 'success');
      } else {
        const r = await api.createWebhook(workspace.id, { url: d.url.trim(), description: d.description, format: d.format, events: d.events, ...(d.scope.trim() ? { scope: d.scope.trim() } : d.projectId ? { projectId: d.projectId } : {}) });
        setEndpoints((list) => [...(list ?? []), r.endpoint]);
        setSecret({ value: r.secret, rotated: false });
      }
      setForm(null);
    } catch (e) {
      notify(errorText(e, tr('couldNotSaveTheWebhook')), 'error');
    } finally {
      setBusy(false);
    }
  };
  const setEnabled = async (e: WebhookEndpointInfo, enabled: boolean) => {
    try {
      replace((await api.updateWebhook(workspace.id, e.id, { enabled })).endpoint);
      notify(enabled ? tr('webhookOnWaitingDeliveriesAre') : tr('webhookOffNothingIsSent'), 'success');
    } catch (err) {
      notify(errorText(err, tr('couldNotChangeTheWebhook')), 'error');
    }
  };
  const test = async (e: WebhookEndpointInfo) => {
    try {
      await api.testWebhook(workspace.id, e.id);
      notify(tr('testSentSeeTheDelivery'), 'success');
      setLog(e.id);
    } catch (err) {
      notify(errorText(err, tr('couldNotSendATest')), 'error');
    }
  };
  const rotate = async (e: WebhookEndpointInfo) => {
    try {
      const r = await api.rotateWebhookSecret(workspace.id, e.id);
      replace(r.endpoint);
      setSecret({ value: r.secret, rotated: true });
    } catch (err) {
      notify(errorText(err, tr('couldNotRotateTheSecret')), 'error');
    }
  };
  const remove = async () => {
    if (!deleting) return;
    try {
      await api.deleteWebhook(workspace.id, deleting.id);
      setEndpoints((list) => (list ?? []).filter((x) => x.id !== deleting.id));
      notify(tr('webhookRemoved'), 'success');
    } catch (err) {
      notify(errorText(err, tr('couldNotRemoveTheWebhook')), 'error');
    } finally {
      setDeleting(null);
    }
  };

  if (!endpoints) return <Spinner />;
  const now = Date.now();
  return (
    <section aria-labelledby="admin-hooks-title">
      <div className="fr-admin-hooks__head">
        <h1 id="admin-hooks-title" className="fr-admin__title">{tr('webhooks')}</h1>
        <Button variant="primary" icon={Plus} onClick={() => setForm({ edit: null })}>{tr('addWebhook')}</Button>
      </div>
      <p className="fr-admin__intro">{tr('sendWhatHappensOnThis')}</p>

      {endpoints.length === 0 ? (
        <div className="fr-admin-card fr-admin-hooks__none">
          <p className="fr-admin__muted">{tr('noWebhooksYet')}</p>
        </div>
      ) : (
        endpoints.map((e) => (
          <div key={e.id} className={`fr-admin-card fr-admin-hooks__item${e.enabled ? '' : ' fr-admin-hooks__item--off'}`} data-testid="webhook">
            <div className="fr-admin-hooks__top">
              <div className="fr-admin-hooks__what">
                <code className="fr-admin-hooks__url">{e.url}</code>
                <span className="fr-admin-pill fr-admin-pill--ok">{FORMAT_LABEL[e.format]}</span>
                {!e.enabled ? <span className="fr-admin-pill fr-admin-pill--off">{e.disabledReason ? tr('turnedOff') : tr('off')}</span> : null}
                {e.description ? <div className="fr-admin-hooks__desc">{e.description}</div> : null}
                {e.scope ? (
                  <div className="fr-admin-hooks__desc">{tr('only')}{' '}{e.scope.itemId ? tr('oneItemOn') : ''}“{e.scope.boardTitle ?? tr('aBoardThatIsGone')}”
                  </div>
                ) : null}
                {e.projectId ? <div className="fr-admin-hooks__desc">{tr('onlyBoardsInProjectname', { projectName: projectName(e.projectId) })}</div> : null}
              </div>
              <Toggle aria-label={tr('sendToUrl', { url: e.url })} checked={e.enabled} onChange={(on) => void setEnabled(e, on)} />
            </div>
            {e.disabledReason ? <p className="fr-admin-hooks__warning">{e.disabledReason}. Fix the receiver, then turn it back on.</p> : null}
            <div className="fr-admin-hooks__events-list">
              {e.events.map((t) => (
                <code key={t}>{t}</code>
              ))}
            </div>
            <div className="fr-admin-hooks__meta fr-admin__muted">{tr('addedValue', { value: relativeTime(e.createdAt, now) })}{e.createdBy ? tr('byName', { name: e.createdBy.name }) : ''} · {e.lastDeliveryAt ? tr('lastDeliveredValue', { value: relativeTime(e.lastDeliveryAt, now) }) : tr('nothingDeliveredYet2')}
              {e.consecutiveFailures > 0 && e.enabled ? tr('consecutivefailuresFailedInARow', { consecutiveFailures: e.consecutiveFailures }) : ''}
            </div>
            <div className="fr-admin-hooks__actions">
              <Button size="sm" variant="secondary" icon={Send} onClick={() => void test(e)} disabled={!e.enabled}>{tr('sendTest')}</Button>
              <Button size="sm" variant="ghost" icon={ScrollText} onClick={() => setLog(log === e.id ? null : e.id)} aria-expanded={log === e.id}>{tr('deliveryLog')}</Button>
              <Button size="sm" variant="ghost" icon={Pencil} onClick={() => setForm({ edit: e })}>{tr('edit')}</Button>
              <Button size="sm" variant="ghost" icon={RefreshCw} onClick={() => void rotate(e)}>{tr('rotateSecret')}</Button>
              <Button size="sm" variant="ghost" icon={Trash2} onClick={() => setDeleting(e)}>{tr('remove')}</Button>
            </div>
            {log === e.id ? <DeliveryLog workspaceId={workspace.id} endpoint={e} /> : null}
          </div>
        ))
      )}
      <p className="fr-admin__muted">{tr('eachJsonDeliveryCarriesA')}{' '}<code>Freero-Signature</code>{' '}{tr('header')}{' '}<code>t=&lt;unix seconds&gt;,v1=&lt;HMAC-SHA256 of “t.body”&gt;</code>{' '}{tr('withTheWebhookSSecret')}</p>

      <Modal open={form !== null} onClose={() => setForm(null)} title={form?.edit ? tr('editWebhook') : tr('addAWebhook')} width={620}>
        {form ? (
          <EndpointForm
            key={form.edit?.id ?? 'new'}
            editing={!!form.edit}
            busy={busy}
            projects={projects}
            initial={
              form.edit
                ? { url: '', description: form.edit.description, format: form.edit.format, events: form.edit.events, scope: scopeAddress(form.edit.scope), projectId: form.edit.projectId ?? '' }
                : { url: '', description: '', format: 'json', events: DEFAULT_EVENTS, scope: '', projectId: '' }
            }
            onSubmit={(d) => void save(d)}
            onCancel={() => setForm(null)}
          />
        ) : null}
      </Modal>

      <Modal
        open={secret !== null}
        onClose={() => setSecret(null)}
        title={secret?.rotated ? tr('theNewSigningSecret') : tr('webhookAdded')}
        width={520}
        footer={
          <Button variant="primary" onClick={() => setSecret(null)}>{tr('done')}</Button>
        }
      >
        <p className="fr-admin-hooks__modal-text">
          {secret?.rotated ? tr('deliveriesAreSignedWithThis') : ''}{tr('copyTheSigningSecretNow2')}</p>
        {secret ? <CopySecret value={secret.value} /> : null}
      </Modal>

      <Modal
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={tr('removeThisWebhook')}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>{tr('cancel')}</Button>
            <Button variant="danger" onClick={() => void remove()}>{tr('remove')}</Button>
          </>
        }
      >
        <p className="fr-admin-hooks__modal-text">{tr('nothingMoreIsSentTo', { url: deleting?.url })}</p>
      </Modal>
    </section>
  );
}
