// Legal holds (#157): the workspace's eDiscovery cases. A case names custodians (every board they own
// here, now and later) and boards; nothing it keeps can be purged until it is released. Owners and
// admins with both the security and content scopes; the server checks every action.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, FileArchive, Gavel, Plus, Unlock } from 'lucide-react';
import type { AdminBoardRow, AdminMember, LegalCaseDetail, LegalCaseSummary, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Spinner, TextArea, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';

import { t as tr } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const STATE_LABEL = { live: 'Live', archived: 'Archived', trashed: 'In the trash', deleted: 'Deleted by its owner (kept)', taken_down: 'Taken down' } as const;

export function AdminLegalHolds({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [cases, setCases] = useState<LegalCaseSummary[] | null>(null);
  const [open, setOpen] = useState<LegalCaseDetail | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.legalCases(workspace.id).then(
      (r) => setCases(r.cases),
      (e) => notify(errorText(e, tr('couldNotLoadTheLegal')), 'error'),
    );
  }, [workspace.id, notify]);
  useEffect(load, [load]);

  const show = async (id: string) => {
    try {
      setOpen((await api.legalCase(workspace.id, id)).case);
    } catch (e) {
      notify(errorText(e, tr('couldNotOpenTheCase')), 'error');
    }
  };

  if (!cases) return <Spinner />;
  return (
    <section aria-labelledby="admin-holds-title">
      <div className="fr-admin__head">
        <h1 id="admin-holds-title" className="fr-admin__title">{tr('legalHolds')}</h1>
        <span className="fr-admin__muted">{tr('whileACaseIsOpen')}</span>
        <div className="fr-admin__head-actions">
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>{tr('newCase')}</Button>
        </div>
      </div>
      <div className="fr-admin-table-wrap">
        <table className="fr-admin-table">
          <thead>
            <tr>
              <th scope="col">{tr('case')}</th>
              <th scope="col">{tr('custodians')}</th>
              <th scope="col">{tr('boardsHeld')}</th>
              <th scope="col">{tr('opened')}</th>
              <th scope="col">{tr('status')}</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c.id}>
                <td>
                  <button type="button" className="fr-admin-link" onClick={() => void show(c.id)}>
                    {c.name}
                  </button>
                </td>
                <td>{c.custodians.map((p) => p.name).join(', ') || '—'}</td>
                <td>{c.releasedAt === null ? c.heldBoards : '—'}</td>
                <td className="fr-admin__muted">
                  {relativeTime(c.createdAt)}
                  {c.createdBy ? tr('byName', { name: c.createdBy.name }) : ''}
                </td>
                <td>{c.releasedAt === null ? <strong>{tr('onHold')}</strong> : <span className="fr-admin__muted">{tr('releasedValue', { value: relativeTime(c.releasedAt) })}</span>}</td>
              </tr>
            ))}
            {cases.length === 0 ? (
              <tr>
                <td colSpan={5} className="fr-admin__muted">{tr('noLegalHoldsOpenA')}</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {creating ? (
        <NewCase
          workspace={workspace}
          onClose={() => setCreating(false)}
          onCreated={(c) => {
            setCreating(false);
            setOpen(c);
            load();
          }}
        />
      ) : null}
      {open ? <CaseDetail workspace={workspace} detail={open} onChange={(c) => (setOpen(c), load())} onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

function NewCase({ workspace, onClose, onCreated }: { workspace: WorkspaceSummary; onClose: () => void; onCreated: (c: LegalCaseDetail) => void }) {
  const notify = useToast();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [boards, setBoards] = useState<AdminBoardRow[] | null>(null);
  const [q, setQ] = useState('');
  const [people, setPeople] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.adminMembers(workspace.id).then((r) => setMembers(r.members), () => setMembers([]));
  }, [workspace.id]);
  useEffect(() => {
    const t = setTimeout(() => {
      void api
        .adminBoards(workspace.id, { filter: '', inactiveDays: 90, sort: 'title', q, offset: 0, limit: 50 })
        .then((r) => setBoards(r.boards), () => setBoards([]));
    }, 200);
    return () => clearTimeout(t);
  }, [workspace.id, q]);

  const toggle = (set: Set<string>, id: string) => {
    const next = new Set(set);
    if (!next.delete(id)) next.add(id);
    return next;
  };
  const create = async () => {
    setBusy(true);
    try {
      const r = await api.createLegalCase(workspace.id, { name, description, custodianIds: [...people], boardIds: [...picked] });
      notify(tr('legalHoldNameIsIn', { name: r.case.name }), 'success');
      onCreated(r.case);
    } catch (e) {
      notify(errorText(e, tr('couldNotOpenTheCase')), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      width={560}
      title={tr('newLegalHold')}
      description={tr('everythingItCoversIsKept')}
      footer={
        <>
          <Button onClick={onClose}>{tr('cancel')}</Button>
          <Button variant="primary" icon={Gavel} loading={busy} disabled={!name.trim() || (!people.size && !picked.size)} onClick={() => void create()}>{tr('placeTheHold')}</Button>
        </>
      }
    >
      <div className="fr-admin-holds__form">
        <Input label={tr('caseName')} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoFocus />
        <TextArea label={tr('notesOptional')} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />
        <fieldset className="fr-admin-holds__pick">
          <legend>{tr('custodiansEveryBoardTheyOwn')}</legend>
          {members === null ? <Spinner /> : null}
          {members?.map((m) => (
            <label key={m.userId} className="fr-admin-holds__option">
              <input type="checkbox" checked={people.has(m.userId)} onChange={() => setPeople((s) => toggle(s, m.userId))} />
              {m.name} <span className="fr-admin__muted">{m.email}</span>
            </label>
          ))}
        </fieldset>
        <fieldset className="fr-admin-holds__pick">
          <legend>{tr('boards')}</legend>
          <Input size="sm" placeholder={tr('findABoard')} value={q} onChange={(e) => setQ(e.target.value)} aria-label={tr('findABoard')} />
          {boards?.map((b) => (
            <label key={b.boardId} className="fr-admin-holds__option">
              <input type="checkbox" checked={picked.has(b.boardId)} onChange={() => setPicked((s) => toggle(s, b.boardId))} />
              {b.title || tr('untitledBoard')} <span className="fr-admin__muted">{b.ownerName}</span>
            </label>
          ))}
        </fieldset>
      </div>
    </Modal>
  );
}

function CaseDetail({ workspace, detail, onChange, onClose }: { workspace: WorkspaceSummary; detail: LegalCaseDetail; onChange: (c: LegalCaseDetail) => void; onClose: () => void }) {
  const notify = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmRelease, setConfirmRelease] = useState(false);
  const openCase = detail.releasedAt === null;
  const latest = useMemo(() => detail.exports.find((e) => e.status === 'ready' && (e.expiresAt ?? 0) > Date.now()) ?? null, [detail.exports]);
  const pending = detail.exports.some((e) => e.status === 'pending' || e.status === 'running');

  // While an export is being built, look again every few seconds.
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => void api.legalCase(workspace.id, detail.id).then((r) => onChange(r.case), () => {}), 3000);
    return () => clearInterval(t);
  }, [pending, workspace.id, detail.id, onChange]);

  const act = async (what: string, fn: () => Promise<LegalCaseDetail | void>, done: string) => {
    setBusy(what);
    try {
      const c = await fn();
      if (c) onChange(c);
      notify(done, 'success');
    } catch (e) {
      notify(errorText(e, tr('thatDidnTWork')), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      width={680}
      title={detail.name}
      description={openCase ? tr('onHoldSinceTolocaledatestringValue', { toLocaleDateString: new Date(detail.createdAt).toLocaleDateString(), value: detail.createdBy ? tr('placedByName', { name: detail.createdBy.name }) : '' }) : tr('releasedValueValue2', { value: relativeTime(detail.releasedAt!), value2: detail.releasedBy ? tr('byName', { name: detail.releasedBy.name }) : '' })}
      footer={
        <>
          {openCase ? (
            <Button variant="danger" icon={Unlock} onClick={() => setConfirmRelease(true)}>{tr('releaseTheHold')}</Button>
          ) : null}
          <Button
            icon={FileArchive}
            loading={busy === 'export' || pending}
            onClick={() =>
              void act(
                'export',
                async () => {
                  await api.exportLegalCase(workspace.id, detail.id);
                  return (await api.legalCase(workspace.id, detail.id)).case;
                },
                tr('preparingTheExport'),
              )
            }
          >
            {pending ? tr('preparingExport') : tr('exportTheCase')}
          </Button>
          {latest ? (
            <a className="fr-btn fr-btn--primary fr-btn--md" href={api.legalCaseExportUrl(workspace.id, detail.id, latest.id)} download>
              <Download size={16} aria-hidden />{' '}{tr('downloadMaxKb', { max: Math.max(1, Math.round((latest.bytes ?? 0) / 1024)) })}</a>
          ) : null}
        </>
      }
    >
      {detail.description ? <p className="fr-admin__muted">{detail.description}</p> : null}
      <h3 className="fr-admin-card__title">{tr('custodians')}</h3>
      <ul className="fr-admin-holds__list">
        {detail.custodians.map((p) => (
          <li key={p.userId}>
            {p.name} <span className="fr-admin__muted">{p.email}</span>
            {openCase ? (
              <Button
                size="sm"
                variant="ghost"
                loading={busy === p.userId}
                onClick={() => void act(p.userId, async () => (await api.changeLegalCase(workspace.id, detail.id, { removeCustodianIds: [p.userId] })).case, tr('nameIsNoLongerA', { name: p.name }))}
              >{tr('remove')}</Button>
            ) : null}
          </li>
        ))}
        {detail.custodians.length === 0 ? <li className="fr-admin__muted">{tr('none')}</li> : null}
      </ul>
      <h3 className="fr-admin-card__title">{openCase ? tr('boardsHeldLength', { length: detail.boards.length }) : tr('boards')}</h3>
      {openCase ? (
        <div className="fr-admin-table-wrap">
          <table className="fr-admin-table">
            <thead>
              <tr>
                <th scope="col">{tr('board')}</th>
                <th scope="col">{tr('owner')}</th>
                <th scope="col">{tr('state')}</th>
                <th scope="col">{tr('heldAs')}</th>
              </tr>
            </thead>
            <tbody>
              {detail.boards.map((b) => (
                <tr key={b.id}>
                  <td className="fr-admin-person__name">{b.title || (b.kind === 'doc' ? tr('untitledDoc') : tr('untitledBoard'))}</td>
                  <td>{b.ownerName}</td>
                  <td>{STATE_LABEL[b.state]}</td>
                  <td className="fr-admin__muted">{b.named ? tr('namedInTheCase') : tr('aCustodianS')}</td>
                </tr>
              ))}
              {detail.boards.length === 0 ? (
                <tr>
                  <td colSpan={4} className="fr-admin__muted">{tr('nothingYetBoardsTheCustodians')}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="fr-admin__muted">{tr('releasedTheBoardsFollowTheir')}</p>
      )}
      {confirmRelease ? (
        <Modal
          open
          onClose={() => setConfirmRelease(false)}
          title={tr('releaseName', { name: detail.name })}
          description={tr('itsBoardsFollowNormalRetention')}
          footer={
            <>
              <Button onClick={() => setConfirmRelease(false)}>{tr('keepTheHold')}</Button>
              <Button
                variant="danger"
                loading={busy === 'release'}
                onClick={() =>
                  void act('release', async () => (await api.releaseLegalCase(workspace.id, detail.id)).case, tr('theHoldWasReleased')).then(() => setConfirmRelease(false))
                }
              >{tr('release')}</Button>
            </>
          }
        />
      ) : null}
    </Modal>
  );
}
