// The workspace's audit log: filter by kind of event, person and dates; page through it; export
// what the filters match as CSV or JSON; re-check the hash chain.
import { useCallback, useEffect, useState } from 'react';
import { Download, ShieldCheck, ShieldAlert } from 'lucide-react';
import { AUDIT_ACTIONS, describeDevice, type AdminMember, type AuditEvent, type AuditIntegrity, type WorkspaceSummary } from '@freero/shared';
import { Button, Input, Select, Spinner, useToast, type SelectOption } from '@ui';
import { api, ApiError, type AuditQuery } from '../../api/client';

const CATEGORIES: SelectOption<string>[] = [
  { value: '', label: 'All events' },
  { value: 'auth.,account.', label: 'Sign-ins and accounts' },
  { value: 'member.,workspace.transferred,workspace.owner_inherited', label: 'Members and roles' },
  { value: 'workspace.policies_changed,workspace.settings_changed,board.link_sharing_changed', label: 'Policies and sharing' },
  { value: 'board.member_invited,board.member_role_changed,board.member_removed', label: 'Board sharing' },
  { value: 'board.exported,board.duplicated,template.saved,audit.exported', label: 'Exports and copies' },
  { value: 'board.trashed,board.restored,board.deleted,board.purged,workspace.deleted,project.deleted', label: 'Deletions and restores' },
  { value: 'version.', label: 'Version restores' },
  { value: 'project.', label: 'Projects' },
];

const PAGE = 50;
const DAY = 86_400_000;

/** yyyy-mm-dd (a date input) → epoch ms at local midnight; '' → undefined. */
const dayStart = (v: string) => (v ? new Date(`${v}T00:00:00`).getTime() : undefined);

function actorText(e: AuditEvent): string {
  if (e.actor) return e.actor.name;
  if (typeof e.metadata.operator === 'string') return `Freero operator (${e.metadata.operator})`;
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

export function AdminAudit({ workspace }: { workspace: WorkspaceSummary }) {
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
        notify(e instanceof ApiError ? e.message : 'Could not load the audit log', 'error');
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
      notify(e instanceof ApiError ? e.message : 'Could not check the audit log', 'error');
    } finally {
      setChecking(false);
    }
  };

  const personOptions: SelectOption<string>[] = [{ value: '', label: 'Anyone' }, ...people.map((p) => ({ value: p.userId, label: p.name, description: p.email }))];

  return (
    <section aria-labelledby="admin-audit-title">
      <div className="fr-admin__head">
        <h1 id="admin-audit-title" className="fr-admin__title">
          Audit log
        </h1>
        <div className="fr-admin__head-actions">
          <a className="fr-admin__button-link" href={api.auditExportUrl(workspace.id, 'csv', filter)} download>
            <Download size={15} aria-hidden /> CSV
          </a>
          <a className="fr-admin__button-link" href={api.auditExportUrl(workspace.id, 'json', filter)} download>
            <Download size={15} aria-hidden /> JSON
          </a>
        </div>
      </div>
      <p className="fr-admin__muted fr-admin__intro">
        Sign-ins, member and role changes, sharing and policy changes, exports, deletions and restores in {workspace.name}, kept for the
        retention you set. Events can’t be edited or removed; each is linked to the one before it, so tampering shows when you check.
      </p>

      <div className="fr-admin-filters">
        <Select<string> aria-label="Kind of event" options={CATEGORIES} value={category} onChange={setCategory} width={220} />
        <Select<string> aria-label="Person" options={personOptions} value={actor} onChange={setActor} width={190} />
        <label className="fr-admin-filters__date">
          From
          <Input type="date" aria-label="From date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="fr-admin-filters__date">
          To
          <Input type="date" aria-label="To date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>

      {events === null ? (
        <Spinner />
      ) : events.length === 0 ? (
        <p className="fr-admin__muted">No events match these filters.</p>
      ) : (
        <div className="fr-admin-table-wrap">
          <table className="fr-admin-table fr-admin-table--audit">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">What</th>
                <th scope="col">Details</th>
                <th scope="col">From</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="fr-admin__nowrap" title={new Date(e.at).toISOString()}>
                    {new Date(e.at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
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
          <Button onClick={() => void more()} loading={loadingMore}>
            Load older events
          </Button>
        </div>
      ) : null}

      <div className="fr-admin-card fr-admin-integrity">
        <div className="fr-admin-row">
          <div className="fr-admin-row__text">
            <span className="fr-admin-row__label">Integrity</span>
            <span className="fr-admin-row__hint">
              Re-checks every stored event against the one before it and against the newest event the log recorded.
            </span>
          </div>
          <div className="fr-admin-row__control">
            <Button icon={ShieldCheck} onClick={() => void verify()} loading={checking}>
              Check now
            </Button>
          </div>
        </div>
        {integrity ? (
          <div className={`fr-admin-integrity__result${integrity.ok ? '' : ' fr-admin-integrity__result--bad'}`} role="status">
            {integrity.ok ? <ShieldCheck size={16} aria-hidden /> : <ShieldAlert size={16} aria-hidden />}
            <span>
              {integrity.ok
                ? `Intact: ${integrity.events} event${integrity.events === 1 ? '' : 's'} checked.`
                : `Not intact: ${integrity.problem}.`}
              {integrity.headHash ? (
                <>
                  {' '}
                  Newest hash <code>{integrity.headHash.slice(0, 16)}…</code> — note it down to prove later that nothing before it changed.
                </>
              ) : null}
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
