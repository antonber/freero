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

const errorText = (e: unknown, fallback: string) => (e instanceof ApiError && e.status < 500 ? e.message : fallback);
const PAGE = 50;

const FILTERS: Array<{ id: AdminBoardFilter; label: string }> = [
  { id: 'link', label: 'Link on' },
  { id: 'public', label: 'Open to visitors' },
  { id: 'guests', label: 'Guests' },
  { id: 'outside', label: 'People from outside' },
  { id: 'inactive', label: 'Unused' },
  { id: 'archived', label: 'Archived' },
];
const SORTS: Array<{ value: AdminBoardSort; label: string }> = [
  { value: 'activity', label: 'Last used' },
  { value: 'title', label: 'Name' },
  { value: 'owner', label: 'Owner' },
  { value: 'size', label: 'Size' },
  { value: 'members', label: 'People invited' },
  { value: 'created', label: 'Created' },
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
    api.adminBoards(workspace.id, { filter: filters.join(','), inactiveDays, sort, q, offset, limit: PAGE }).then(setPage, (e) => notify(errorText(e, 'Could not load the boards'), 'error'));
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
      notify(errorText(e, 'Could not change it'), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section aria-labelledby="admin-boards-title">
      <div className="fr-admin__head">
        <h1 id="admin-boards-title" className="fr-admin__title">
          Boards
        </h1>
        <span className="fr-admin__muted">Every board in {workspace.name}: who owns it, how it is shared and when it was last used. You see details, not content.</span>
      </div>
      <div className="fr-admin-inventory__bar">
        <Input aria-label="Search boards" placeholder="Search by name or owner" value={q} onChange={(e) => (setOffset(0), setQ(e.target.value))} className="fr-admin__search" />
        <Select<AdminBoardSort> aria-label="Sort by" options={SORTS} value={sort} onChange={(s) => (setOffset(0), setSort(s))} width={160} />
      </div>
      <div className="fr-admin-inventory__filters" role="group" aria-label="Show only">
        {FILTERS.map((f) => (
          <label key={f.id} className="fr-admin-scopes__item">
            <input type="checkbox" checked={filters.includes(f.id)} onChange={() => toggle(f.id)} />
            {f.label}
            {f.id === 'inactive' ? (
              <>
                {' '}for
                <input
                  type="number"
                  className="fr-admin-inventory__days"
                  aria-label="Days unused"
                  min={1}
                  max={3650}
                  value={inactiveDays}
                  onChange={(e) => setInactiveDays(Math.max(1, Math.min(3650, Number(e.target.value) || 1)))}
                />{' '}
                days
              </>
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
                  <th scope="col">Board</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Link</th>
                  <th scope="col">Invited</th>
                  <th scope="col">Size</th>
                  <th scope="col">Last used</th>
                  <th scope="col">
                    <span className="fr-admin__sr">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.boards.map((b) => (
                  <tr key={b.boardId}>
                    <td>
                      <div className="fr-admin-person__name">
                        {b.title || (b.kind === 'doc' ? 'Untitled doc' : 'Untitled board')}
                        {b.archivedAt ? <span className="fr-admin-pill">Archived</span> : null}
                      </div>
                      <div className="fr-admin__muted">{b.projectName ?? 'No project'}</div>
                    </td>
                    <td>{b.ownerName}</td>
                    <td>
                      {LINK_TEXT[b.linkAccess]}
                      {b.publicLink ? <span className="fr-admin-pill fr-admin-pill--warn">Visitors</span> : null}
                      {b.linkPassword ? <span className="fr-admin__muted"> · password</span> : null}
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
                          onClick={() => void act(b, 'link-off', `The link to “${b.title}” is off`)}
                        >
                          Link off
                        </Button>
                      ) : null}
                      {b.outsiders ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={UserMinus}
                          loading={busy === `${b.boardId}:remove-outsiders`}
                          onClick={() => void act(b, 'remove-outsiders', `People from outside can no longer open “${b.title}”`)}
                        >
                          Remove outsiders
                        </Button>
                      ) : null}
                      <Button size="sm" variant="ghost" icon={Crown} onClick={() => setHanding(b)}>
                        Hand on
                      </Button>
                    </td>
                  </tr>
                ))}
                {page.boards.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="fr-admin__muted">
                      No board matches.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          <div className="fr-admin-inventory__pages">
            <span className="fr-admin__muted">
              {page.total === 0 ? 'No boards' : `${offset + 1}–${Math.min(offset + PAGE, page.total)} of ${page.total}`}
            </span>
            <Button size="sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
              Previous
            </Button>
            <Button size="sm" disabled={offset + PAGE >= page.total} onClick={() => setOffset(offset + PAGE)}>
              Next
            </Button>
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
      notify(`“${board.title}” now belongs to ${members?.find((m) => m.userId === to)?.name ?? 'them'}`, 'success');
      onDone();
      onClose();
    } catch (e) {
      notify(errorText(e, 'Could not hand it on'), 'error');
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={`Hand “${board.title || 'Untitled board'}” on`}
      width={440}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={busy} disabled={!to} onClick={() => void submit()}>
            Hand on
          </Button>
        </>
      }
    >
      {!members ? (
        <Spinner />
      ) : (
        <Select<string>
          aria-label="New owner"
          options={[{ value: '', label: 'Choose a member' }, ...members.map((m) => ({ value: m.userId, label: `${m.name} · ${m.email}` }))]}
          value={to}
          onChange={setTo}
          width={380}
        />
      )}
      <p className="fr-admin__modal-text">{board.ownerName} keeps editing it. It stays where it is in the workspace.</p>
    </Modal>
  );
}
