// The board inventory for the workspace's content admins (#152): every board with its owner,
// project, how it is shared and when it was last used; filters for risky sharing and idle boards;
// turning a link off, removing people from outside and handing a board on, each checked and audited
// by the server. Metadata only: opening a board still needs access to it.
import { useCallback, useEffect, useState } from 'react';
import { Crown, Link2Off, UserMinus } from 'lucide-react';
import type { AdminBoardFilter, AdminBoardRow, AdminBoardSort, AdminMember, WorkspaceSummary } from '@freero/shared';
import { Button, Input, Modal, Select, Spinner, useToast } from '@ui';
import { api, ApiError } from '../../api/client';
import { relativeTime } from '../../lib/time';
import { formatBytes } from './AdminOverview';

import { t } from './messages';
const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const PAGE = 50;

const FILTERS: Array<{ id: AdminBoardFilter; label: string }> = [
  { id: 'link', label: t('linkOn') },
  { id: 'public', label: t('openToVisitors') },
  { id: 'guests', label: t('guests') },
  { id: 'outside', label: t('peopleFromOutside') },
  { id: 'inactive', label: t('unused') },
  { id: 'archived', label: t('archived') },
];
const SORTS: Array<{ value: AdminBoardSort; label: string }> = [
  { value: 'activity', label: t('lastUsed') },
  { value: 'title', label: t('name') },
  { value: 'owner', label: t('owner') },
  { value: 'size', label: t('size') },
  { value: 'members', label: t('peopleInvited') },
  { value: 'created', label: t('created') },
];
const LINK_TEXT = { none: 'Off', viewer: 'Can view', commenter: 'Can comment', editor: 'Can edit' } as const;

export function AdminBoards({ workspace }: { workspace: WorkspaceSummary }) {
  const notify = useToast();
  const [filters, setFilters] = useState<AdminBoardFilter[]>([]);
  const [inactiveDays, setInactiveDays] = useState(90);
  const [sort, setSort] = useState<AdminBoardSort>('activity');
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<{ boards: AdminBoardRow[]; total: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [handing, setHanding] = useState<AdminBoardRow | null>(null);

  const load = useCallback(() => {
    api.adminBoards(workspace.id, { filter: filters.join(','), inactiveDays, sort, q, offset, limit: PAGE }).then(setPage, (e) => notify(errorText(e, t('couldNotLoadTheBoards')), 'error'));
  }, [workspace.id, filters, inactiveDays, sort, q, offset, notify]);
  useEffect(load, [load]);

  const toggle = (f: AdminBoardFilter) => {
    setOffset(0);
    setFilters((all) => (all.includes(f) ? all.filter((x) => x !== f) : [...all, f]));
  };

  const act = async (b: AdminBoardRow, what: 'link-off' | 'remove-outsiders', done: string) => {
    setBusy(`${b.boardId}:${what}`);
    try {
      if (what === 'link-off') await api.adminBoardLinkOff(workspace.id, b.boardId);
      else await api.adminRemoveOutsiders(workspace.id, b.boardId);
      notify(done, 'success');
      load();
    } catch (e) {
      notify(errorText(e, t('couldNotChangeIt')), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="admin-boards-title">
      <div className="fr-admin__head">
        <h1 id="admin-boards-title" className="fr-admin__title">{t('boards')}</h1>
        <span className="fr-admin__muted">{t('everyBoardInNameWho', { name: workspace.name })}</span>
      </div>
      <div className="fr-admin-inventory__bar">
        <Input aria-label={t('searchBoards')} placeholder={t('searchByNameOrOwner')} value={q} onChange={(e) => (setOffset(0), setQ(e.target.value))} className="fr-admin__search" />
        <Select<AdminBoardSort> aria-label={t('sortBy')} options={SORTS} value={sort} onChange={(s) => (setOffset(0), setSort(s))} width={160} />
      </div>
      <div className="fr-admin-inventory__filters" role="group" aria-label={t('showOnly')}>
        {FILTERS.map((f) => (
          <label key={f.id} className="fr-admin-scopes__item">
            <input type="checkbox" checked={filters.includes(f.id)} onChange={() => toggle(f.id)} />
            {f.label}
            {f.id === 'inactive' ? (
              <>{t('for')}<input
                  type="number"
                  className="fr-admin-inventory__days"
                  aria-label={t('daysUnused')}
                  min={1}
                  max={3650}
                  value={inactiveDays}
                  onChange={(e) => setInactiveDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
                />{t('days')}</>
            ) : null}
          </label>
        ))}
      </div>
      {!page ? (
        <Spinner />
      ) : (
        <>
          <div className="fr-admin-table-wrap">
            <table className="fr-admin-table">
              <thead>
                <tr>
                  <th scope="col">{t('board')}</th>
                  <th scope="col">{t('owner')}</th>
                  <th scope="col">{t('link')}</th>
                  <th scope="col">{t('invited')}</th>
                  <th scope="col">{t('size')}</th>
                  <th scope="col">{t('lastUsed')}</th>
                  <th scope="col">
                    <span className="fr-admin__sr">{t('actions')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.boards.map((b) => (
                  <tr key={b.boardId}>
                    <td>
                      <div className="fr-admin-person__name">
                        {b.title || (b.kind === 'doc' ? t('untitledDoc') : t('untitledBoard'))}
                        {b.archivedAt ? <span className="fr-admin-pill">{t('archived')}</span> : null}
                      </div>
                      <div className="fr-admin__muted">{b.projectName ?? t('noProject')}</div>
                    </td>
                    <td>{b.ownerName}</td>
                    <td>
                      {LINK_TEXT[b.linkAccess]}
                      {b.publicLink ? <span className="fr-admin-pill fr-admin-pill--warn">{t('visitors')}</span> : null}
                      {b.linkPassword ? <span className="fr-admin__muted">{' '}{t('password')}</span> : null}
                    </td>
                    <td>
                      {b.members}
                      {b.guests || b.outsiders ? (
                        <div className="fr-admin__muted">
                          {[b.guests ? `${b.guests} guest${b.guests === 1 ? '' : 's'}` : null, b.outsiders ? `${b.outsiders} from outside` : null].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="fr-admin__muted">{formatBytes(b.bytes)}</td>
                    <td className="fr-admin__muted">{relativeTime(b.lastActivityAt)}</td>
                    <td className="fr-admin-table__actions">
                      {b.linkAccess !== 'none' ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Link2Off}
                          loading={busy === `${b.boardId}:link-off`}
                          onClick={() => void act(b, 'link-off', t('theLinkToTitleIs', { title: b.title }))}
                        >{t('linkOff')}</Button>
                      ) : null}
                      {b.outsiders ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={UserMinus}
                          loading={busy === `${b.boardId}:remove-outsiders`}
                          onClick={() => void act(b, 'remove-outsiders', t('peopleFromOutsideCanNo', { title: b.title }))}
                        >{t('removeOutsiders')}</Button>
                      ) : null}
                      <Button size="sm" variant="ghost" icon={Crown} onClick={() => setHanding(b)}>{t('handOn')}</Button>
                    </td>
                  </tr>
                ))}
                {page.boards.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="fr-admin__muted">{t('noBoardMatches')}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="fr-admin-inventory__pages">
            <span className="fr-admin__muted">
              {page.total === 0 ? t('noBoards') : t('valueMinOfTotal', { value: offset + 1, min: Math.min(offset + PAGE, page.total), total: page.total })}
            </span>
            <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>{t('previous')}</Button>
            <Button size="sm" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>{t('next2')}</Button>
          </div>
        </>
      )}
      {handing ? <HandOn workspace={workspace} board={handing} onClose={() => setHanding(null)} onDone={load} /> : null}
    </section>
  );
}

/** Hands a board to another member of the workspace (not a guest); the previous owner keeps editing. */
function HandOn({ workspace, board, onClose, onDone }: { workspace: WorkspaceSummary; board: AdminBoardRow; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const [members, setMembers] = useState<AdminMember[] | null>(null);
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.adminMembers(workspace.id).then(
      (r) => setMembers(r.members.filter((m) => m.role !== 'guest' && !m.deactivated && m.userId !== board.ownerId)),
      () => setMembers([]),
    );
  }, [workspace.id, board.ownerId]);
  const submit = async () => {
    setBusy(true);
    try {
      await api.adminTransferBoard(workspace.id, board.boardId, to);
      notify(t('titleNowBelongsToValue', { title: board.title, value: members?.find((m) => m.userId === to)?.name ?? t('them') }), 'success');
      onDone();
      onClose();
    } catch (e) {
      notify(errorText(e, t('couldNotHandItOn')), 'error');
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={t('handValueOn', { value: board.title || t('untitledBoard') })}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} disabled={!to} onClick={() => void submit()}>{t('handOn')}</Button>
        </>
      }
    >
      {!members ? (
        <Spinner />
      ) : (
        <Select<string>
          aria-label={t('newOwner')}
          options={[{ value: '', label: t('chooseAMember') }, ...members.map((m) => ({ value: m.userId, label: `${m.name} · ${m.email}` }))]}
          value={to}
          onChange={setTo}
          width={380}
        />
      )}
      <p className="fr-admin__modal-text">{t('ownernameKeepsEditingItIt', { ownerName: board.ownerName })}</p>
    </Modal>
  );
}
