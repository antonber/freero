// The workspace's audit log: filter by kind of event, person and dates; page through it; export
// what the filters match as CSV or JSON; re-check the hash chain.
import { useCallback, useEffect, useState } from 'react';
import { Download, ShieldCheck, ShieldAlert } from 'lucide-react';
import { AUDIT_ACTIONS, describeDevice, type AdminMember, type AuditEvent, type AuditIntegrity, type WorkspaceSummary } from '@freero/shared';
import { Button, Input, Select, Spinner, useToast, type SelectOption } from '@ui';
import { api, ApiError, type AuditQuery } from '../../api/client';

import { t } from './messages';
const CATEGORIES: SelectOption<string>[] = [
  { value: '', label: t('allEvents') },
  { value: 'organisation.', label: t('organisation') },
  { value: 'auth.,account.', label: t('signInsAndAccounts') },
  { value: 'member.,workspace.transferred,workspace.owner_inherited', label: t('membersAndRoles') },
  { value: 'workspace.policies_changed,workspace.settings_changed,board.link_sharing_changed,board.embedding_changed', label: t('policiesAndSharing') },
  { value: 'board.member_invited,board.member_role_changed,board.member_removed', label: t('boardSharing') },
  { value: 'board.exported,board.duplicated,board.download_refused,template.saved,audit.exported', label: t('exportsAndCopies') },
  { value: 'api.', label: t('apiTokensAppsAndCalls') },
  { value: 'board.trashed,board.restored,board.deleted,board.purged,workspace.deleted,project.deleted', label: t('deletionsAndRestores') },
  { value: 'version.', label: t('versionRestores') },
  { value: 'project.', label: t('projects') },
];

const PAGE = 50;
const DAY = 86_400_000;

/** yyyy-mm-dd (a date input) → epoch ms at local midnight; '' → undefined. */
const dayStart = (v: string) => (v ? new Date(`${v}T00:00:00`).getTime() : undefined);

function actorText(e: AuditEvent): string {
  if (e.actor) return e.actor.name;
  if (typeof e.metadata.operator === 'string') return t('freeroOperatorOperator', { operator: e.metadata.operator });
  if (e.action === 'auth.login_failed') return 'Someone';
  return 'Freero';
}

/** The event's details in a line: metadata as "key: value", without ids nobody can read. */
function detailText(e: AuditEvent): string {
  const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : Array.isArray(v) ? v.join(', ') : String(v));
  const parts: string[] = [];
  const changes = new Map<string, { from?: unknown; to?: unknown }>();
  for (const [k, v] of Object.entries(e.metadata)) {
    const m = /^(.+)\.(from|to)$/.exec(k);
    if (m) changes.set(m[1], { ...changes.get(m[1]), [m[2]]: v });
    else if (k === 'from' && 'to' in e.metadata) changes.set('', { ...changes.get(''), from: v });
    else if (k === 'to' && 'from' in e.metadata) changes.set('', { ...changes.get(''), to: v });
    else if (v !== null && v !== '' && k !== 'operator') parts.push(`${k}: ${show(v)}`);
  }
  const moves = [...changes].map(([k, c]) => `${k ? `${k}: ` : ''}${show(c.from)} → ${show(c.to)}`);
  return [...moves, ...parts].join(' · ');
}

/**
 * `workspaceNames` (an organisation's merged log, #108): each event says which of its workspaces it
 * happened in.
 */
export function AdminAudit({ workspace, workspaceNames }: { workspace: WorkspaceSummary; workspaceNames?: Map<string, string> }) {
  const notify = useToast();
  const [category, setCategory] = useState('');
  const [actor, setActor] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [people, setPeople] = useState<AdminMember[]>([]);
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [integrity, setIntegrity] = useState<AuditIntegrity | null>(null);
  const [checking, setChecking] = useState(false);

  const filter: AuditQuery = { action: category || undefined, actor: actor || undefined, from: dayStart(from), to: to ? dayStart(to)! + DAY : undefined };

  useEffect(() => {
    api.adminMembers(workspace.id).then((r) => setPeople(r.members), () => undefined);
  }, [workspace.id]);

  const load = useCallback(
    async (before?: string) => {
      try {
        const page = await api.auditEvents(workspace.id, { ...filter, before, limit: PAGE });
        setEvents((prev) => (before ? [...(prev ?? []), ...page.events] : page.events));
        setNext(page.next);
      } catch (e) {
        notify(e instanceof ApiError ? e.message : t('couldNotLoadTheAudit'), 'error');
        if (!before) setEvents([]);
      }
    },
    [workspace.id, category, actor, from, to],
  );

  useEffect(() => {
    setEvents(null);
    void load();
  }, [load]);

  const more = async () => {
    setLoadingMore(true);
    await load(next ?? undefined);
    setLoadingMore(false);
  };

  const verify = async () => {
    setChecking(true);
    try {
      setIntegrity((await api.auditIntegrity(workspace.id)).integrity);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : t('couldNotCheckTheAudit'), 'error');
    } finally {
      setChecking(false);
    }
  };

  const personOptions: SelectOption<string>[] = [{ value: '', label: t('anyone') }, ...people.map((p) => ({ value: p.userId, label: p.name, description: p.email }))];

  return (
    <section aria-labelledby="admin-audit-title">
      <div className="fr-admin__head">
        <h1 id="admin-audit-title" className="fr-admin__title">{t('auditLog')}</h1>
        <div className="fr-admin__head-actions">
          <a className="fr-admin__button-link" href={api.auditExportUrl(workspace.id, 'csv', filter)} download>
            <Download size={15} aria-hidden /> CSV
          </a>
          <a className="fr-admin__button-link" href={api.auditExportUrl(workspace.id, 'json', filter)} download>
            <Download size={15} aria-hidden /> JSON
          </a>
        </div>
      </div>
      <p className="fr-admin__muted fr-admin__intro">{t('signInsMemberAndRole', { name: workspace.name })}{workspaceNames ? t('andEveryOneOfIts') : ''}{t('keptForTheRetentionYou')}</p>

      <div className="fr-admin-filters">
        <Select<string> aria-label={t('kindOfEvent')} options={CATEGORIES} value={category} onChange={setCategory} width={220} />
        <Select<string> aria-label={t('person')} options={personOptions} value={actor} onChange={setActor} width={190} />
        <label className="fr-admin-filters__date">{t('from')}<Input type="date" aria-label={t('fromDate')} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="fr-admin-filters__date">{t('to')}<Input type="date" aria-label={t('toDate')} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {events === null ? (
        <Spinner />
      ) : events.length === 0 ? (
        <p className="fr-admin__muted">{t('noEventsMatchTheseFilters')}</p>
      ) : (
        <div className="fr-admin-table-wrap">
          <table className="fr-admin-table fr-admin-table--audit">
            <thead>
              <tr>
                <th scope="col">{t('when')}</th>
                {workspaceNames ? <th scope="col">{t('where')}</th> : null}
                <th scope="col">{t('who')}</th>
                <th scope="col">{t('what')}</th>
                <th scope="col">{t('details')}</th>
                <th scope="col">{t('from')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="fr-admin__nowrap" title={new Date(e.at).toISOString()}>
                    {new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  {workspaceNames ? (
                    <td className="fr-admin__muted">
                      {!e.workspaceId ? t('account') : e.workspaceId === workspace.id ? t('organisation') : (workspaceNames.get(e.workspaceId) ?? t('aFormerWorkspace'))}
                    </td>
                  ) : null}
                  <td>
                    <div className="fr-admin-person__name">{actorText(e)}</div>
                    {e.actor?.email ? <div className="fr-admin__muted">{e.actor.email}</div> : null}
                  </td>
                  <td>
                    <div>{AUDIT_ACTIONS[e.action] ?? e.action}</div>
                    {e.target?.label ? <div className="fr-admin__muted">{e.target.label}</div> : null}
                  </td>
                  <td className="fr-admin-audit__details">{detailText(e)}</td>
                  <td className="fr-admin__muted">
                    {e.ip ?? '—'}
                    {e.userAgent ? <div>{describeDevice(e.userAgent)}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {next ? (
        <div className="fr-admin__more">
          <Button onClick={() => void more()} loading={loadingMore}>{t('loadOlderEvents')}</Button>
        </div>
      ) : null}

      <div className="fr-admin-card fr-admin-integrity">
        <div className="fr-admin-row">
          <div className="fr-admin-row__text">
            <span className="fr-admin-row__label">{t('integrity')}</span>
            <span className="fr-admin-row__hint">{t('reChecksEveryStoredEvent')}</span>
          </div>
          <div className="fr-admin-row__control">
            <Button icon={ShieldCheck} onClick={() => void verify()} loading={checking}>{t('checkNow')}</Button>
          </div>
        </div>
        {integrity ? (
          <div className={`fr-admin-integrity__result${integrity.ok ? '' : ' fr-admin-integrity__result--bad'}`} role="status">
            {integrity.ok ? <ShieldCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
            <span>
              {integrity.ok
                ? t('intactEventsEventsChecked', { events: integrity.events })
                : t('notIntactProblem', { problem: integrity.problem })}
              {integrity.anchors.checked
                ? t('matchesCheckedSignedCheckpointsNewest', { checked: integrity.anchors.checked, value: new Date(integrity.anchors.lastAt ?? 0).toLocaleString() })
                : ''}
              {integrity.headHash ? (
                <>{t('newestHash')}{' '}<code>{integrity.headHash.slice(0, 16)}…</code>{' '}{t('noteItDownToProve')}</>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
