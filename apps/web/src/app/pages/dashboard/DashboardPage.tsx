import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LayoutGrid, LayoutTemplate, List, Plus, RotateCw, Search, X } from 'lucide-react';
import type { BoardSummary } from '@freero/shared';
import { Button, IconButton, Input, Kbd, Modal, SegmentedControl, Select, Skeleton, Spinner, useToast } from '@ui';
import { api, ApiError, type BoardFilter } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ShareDialog } from '../../components/ShareDialog';
import { filterByOwner, sortBoards, type BoardSort, type OwnerFilter } from '../../lib/boards';
import { useDebouncedValue, usePersistentState } from '../../lib/hooks';
import { BoardItem, type BoardActions } from './BoardItem';
import { NAV, Sidebar, type View } from './Sidebar';
import './dashboard.css';

const VIEW_FILTER: Record<View, BoardFilter> = { home: 'all', recent: 'recent', starred: 'starred', shared: 'shared', mine: 'mine' };
const VIEW_TITLE: Record<View, string> = { home: 'All boards', recent: 'Recently opened', starred: 'Starred', shared: 'Shared with me', mine: 'My boards' };
const SORTS = ['opened', 'modified', 'name'] as const;
const LAYOUTS = ['grid', 'list'] as const;

const EMPTY: Record<View, { title: string; body: string }> = {
  home: { title: 'Your canvas is waiting', body: 'Create your first board to sketch, plan and brainstorm with your team.' },
  recent: { title: 'Nothing opened yet', body: 'Boards you open will line up here so you can jump right back in.' },
  starred: { title: 'No starred boards', body: 'Star the boards you use most to keep them one click away.' },
  shared: { title: 'Nothing shared with you yet', body: 'When teammates invite you to a board, it will show up here.' },
  mine: { title: 'You haven’t created a board yet', body: 'Start a blank board or pick a template to get going.' },
};

const UNTITLED = 'Untitled board';

export function DashboardPage() {
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawView = params.get('view') as View | null;
  const view: View = rawView && rawView in VIEW_FILTER ? rawView : 'home';

  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [layout, setLayout] = usePersistentState<'grid' | 'list'>('fr.dashboard.layout', 'grid', LAYOUTS);
  const [sort, setSort] = usePersistentState<BoardSort>('fr.dashboard.sort', 'opened', SORTS);
  const [owner, setOwner] = useState<OwnerFilter>('any');

  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState<'blank' | 'template' | null>(null);
  const reqId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // dialogs
  const [renaming, setRenaming] = useState<BoardSummary | null>(null);
  const [deleting, setDeleting] = useState<BoardSummary | null>(null);
  const [leaving, setLeaving] = useState<BoardSummary | null>(null);
  const [sharing, setSharing] = useState<BoardSummary | null>(null);

  useEffect(() => {
    document.title = 'Boards · Freero';
  }, []);

  const load = useCallback(async () => {
    const id = ++reqId.current;
    setLoadFailed(false);
    try {
      const { boards } = await api.listBoards(VIEW_FILTER[view], q);
      if (id === reqId.current) setBoards(boards);
    } catch (e) {
      if (id !== reqId.current) return;
      setLoadFailed(true);
      setBoards((b) => b ?? []);
      notify(e instanceof ApiError ? e.message : 'Could not load your boards', 'error');
    }
  }, [view, q, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the skeleton when switching views (not when searching, to avoid flashes).
  useEffect(() => {
    setBoards(null);
    setOwner('any');
  }, [view]);

  // "/" focuses search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const setView = (v: View) => {
    setQuery('');
    setParams(v === 'home' ? {} : { view: v });
  };

  const patchBoard = useCallback((id: string, patch: Partial<BoardSummary>) => {
    setBoards((list) => list?.map((b) => (b.id === id ? { ...b, ...patch } : b)) ?? null);
  }, []);

  const create = async (kind: 'blank' | 'template') => {
    if (creating) return;
    setCreating(kind);
    try {
      const { board } = await api.createBoard({ title: UNTITLED });
      navigate(`/board/${board.id}${kind === 'template' ? '?dock=templates' : ''}`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not create a board', 'error');
      setCreating(null);
    }
  };

  // Stable action handlers so memoized cards don't re-render on every keystroke.
  const viewRef = useRef(view);
  viewRef.current = view;
  const actions = useMemo<BoardActions>(
    () => ({
      open: (b) => navigate(`/board/${b.id}`),
      rename: (b) => setRenaming(b),
      share: (b) => setSharing(b),
      remove: (b) => setDeleting(b),
      leave: (b) => setLeaving(b),
      duplicate: async (b) => {
        try {
          const { board } = await api.duplicateBoard(b.id);
          setBoards((list) => (list ? [board, ...list] : [board]));
          notify(`Duplicated “${b.title || UNTITLED}”`, 'success', {
            action: { label: 'Open', onClick: () => navigate(`/board/${board.id}`) },
          });
        } catch (e) {
          notify(e instanceof ApiError ? e.message : 'Could not duplicate the board', 'error');
        }
      },
      toggleStar: async (b) => {
        const starred = !b.starred;
        // In the Starred view, unstarring removes the card.
        if (!starred && viewRef.current === 'starred') setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
        else patchBoard(b.id, { starred });
        try {
          await (starred ? api.star(b.id) : api.unstar(b.id));
        } catch (e) {
          if (!starred && viewRef.current === 'starred') setBoards((list) => (list ? [b, ...list] : [b]));
          else patchBoard(b.id, { starred: b.starred });
          notify(e instanceof ApiError ? e.message : 'Could not update star', 'error');
        }
      },
    }),
    [navigate, notify, patchBoard],
  );

  if (!user) return null;

  const visible = boards ? sortBoards(filterByOwner(boards, owner, user.id), sort) : null;
  const showCreate = view === 'home' || view === 'mine';
  const showOwnerTabs = view === 'home' || view === 'recent' || view === 'starred';
  const searching = q.length > 0;

  return (
    <div className="fr-dash">
      <Sidebar view={view} onView={setView} />

      <div className="fr-dash__main">
        <header className="fr-dash__top">
          <Input
            ref={searchRef}
            className="fr-dash__search"
            icon={Search}
            placeholder="Search boards"
            aria-label="Search boards"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query) {
                e.stopPropagation();
                setQuery('');
              }
            }}
            suffix={
              query ? (
                <IconButton size={32} icon={X} label="Clear search" tooltip={false} onClick={() => setQuery('')} />
              ) : (
                <Kbd className="fr-dash__search-kbd">/</Kbd>
              )
            }
          />
          <Button variant="primary" icon={Plus} loading={creating === 'blank'} onClick={() => create('blank')} className="fr-dash__new">
            New board
          </Button>
        </header>

        <div className="fr-dash__scroll">
          {showCreate && !searching ? (
            <section className="fr-create" aria-label="Create">
              <button type="button" className="fr-create__tile fr-create__tile--blank" onClick={() => create('blank')} disabled={!!creating}>
                <span className="fr-create__icon">{creating === 'blank' ? <Spinner size={22} /> : <Plus size={24} strokeWidth={2.4} />}</span>
                <span className="fr-create__text">
                  <span className="fr-create__title">New board</span>
                  <span className="fr-create__sub">Start from a blank canvas</span>
                </span>
              </button>
              <button type="button" className="fr-create__tile fr-create__tile--template" onClick={() => create('template')} disabled={!!creating}>
                <span className="fr-create__icon">{creating === 'template' ? <Spinner size={22} /> : <LayoutTemplate size={22} />}</span>
                <span className="fr-create__text">
                  <span className="fr-create__title">From template</span>
                  <span className="fr-create__sub">Retros, roadmaps, brainstorms</span>
                </span>
              </button>
            </section>
          ) : null}

          <section className="fr-collection" aria-label={VIEW_TITLE[view]}>
            <div className="fr-collection__head">
              <h1 className="fr-collection__title">
                {searching ? `Results for “${q}”` : VIEW_TITLE[view]}
                {visible ? <span className="fr-collection__count">{visible.length}</span> : null}
              </h1>
              <div className="fr-collection__controls">
                {showOwnerTabs ? (
                  <div className="fr-tabs" role="tablist" aria-label="Owner">
                    {(
                      [
                        ['any', 'All'],
                        ['me', 'Owned by me'],
                        ['others', 'Owned by others'],
                      ] as const
                    ).map(([id, label]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={owner === id}
                        className={`fr-tab${owner === id ? ' fr-tab--on' : ''}`}
                        onClick={() => setOwner(id)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <Select<BoardSort>
                  aria-label="Sort boards"
                  size="sm"
                  variant="ghost"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: 'opened', label: 'Last opened' },
                    { value: 'modified', label: 'Last modified' },
                    { value: 'name', label: 'Name' },
                  ]}
                />
                <SegmentedControl<'grid' | 'list'>
                  aria-label="Layout"
                  size="sm"
                  value={layout}
                  onChange={setLayout}
                  options={[
                    { value: 'grid', icon: LayoutGrid, title: 'Grid view' },
                    { value: 'list', icon: List, title: 'List view' },
                  ]}
                />
              </div>
            </div>

            {visible === null ? (
              <BoardsSkeleton layout={layout} />
            ) : loadFailed && visible.length === 0 ? (
              <div className="fr-empty">
                <h2 className="fr-empty__title">Couldn’t load your boards</h2>
                <p className="fr-empty__body">Check your connection and try again.</p>
                <Button icon={RotateCw} onClick={() => void load()}>
                  Try again
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <EmptyState view={view} query={q} filtered={owner !== 'any' && (boards?.length ?? 0) > 0} onCreate={() => create('blank')} creating={creating === 'blank'} />
            ) : layout === 'grid' ? (
              <div className="fr-dash-grid">
                {visible.map((b) => (
                  <BoardItem key={b.id} board={b} layout="grid" sort={sort} userId={user.id} actions={actions} />
                ))}
              </div>
            ) : (
              <div className="fr-list" role="list">
                <div className="fr-list__head" aria-hidden>
                  <span />
                  <span>Name</span>
                  <span>Owner</span>
                  <span>{sort === 'opened' ? 'Last opened' : 'Last modified'}</span>
                  <span />
                </div>
                {visible.map((b) => (
                  <BoardItem key={b.id} board={b} layout="list" sort={sort} userId={user.id} actions={actions} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <RenameModal
        board={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(b) => {
          patchBoard(b.id, { title: b.title, updatedAt: b.updatedAt });
          setRenaming(null);
        }}
      />
      <ConfirmModal
        open={!!deleting}
        title={`Delete “${deleting?.title || UNTITLED}”?`}
        body="The board and everything on it will be removed for everyone with access. This can’t be undone."
        confirmLabel="Delete board"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const b = deleting!;
          await api.deleteBoard(b.id);
          setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
          notify('Board deleted', 'info');
        }}
      />
      <ConfirmModal
        open={!!leaving}
        title={`Leave “${leaving?.title || UNTITLED}”?`}
        body="You’ll lose access until someone invites you again."
        confirmLabel="Leave board"
        onClose={() => setLeaving(null)}
        onConfirm={async () => {
          const b = leaving!;
          await api.removeMember(b.id, user.id);
          setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
          notify('You left the board', 'info');
        }}
      />
      {sharing ? (
        <ShareDialog
          boardId={sharing.id}
          board={sharing}
          open
          onClose={() => setSharing(null)}
          onBoardChange={(b) => patchBoard(b.id, { linkAccess: b.linkAccess })}
          onLeft={() => setBoards((list) => list?.filter((x) => x.id !== sharing.id) ?? null)}
        />
      ) : null}
    </div>
  );
}

function BoardsSkeleton({ layout }: { layout: 'grid' | 'list' }) {
  if (layout === 'list') {
    return (
      <div className="fr-list" aria-busy="true" aria-label="Loading boards">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="fr-row fr-row--skeleton">
            <Skeleton width={56} height={36} radius={6} />
            <Skeleton width="40%" height={14} />
            <Skeleton width={90} height={12} />
            <Skeleton width={70} height={12} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="fr-dash-grid" aria-busy="true" aria-label="Loading boards">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="fr-dash-card fr-dash-card--skeleton">
          <Skeleton height="auto" radius={0} style={{ aspectRatio: '16 / 10' }} />
          <div className="fr-dash-card__meta">
            <Skeleton width="70%" height={14} />
            <Skeleton width="45%" height={11} style={{ marginTop: 8 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  view,
  query,
  filtered,
  onCreate,
  creating,
}: {
  view: View;
  query: string;
  filtered: boolean;
  onCreate: () => void;
  creating: boolean;
}) {
  const content = query
    ? { title: `No boards match “${query}”`, body: 'Try a different word, or check another section.' }
    : filtered
      ? { title: 'No boards here', body: 'Nothing matches this owner filter. Try “All”.' }
      : EMPTY[view];
  const Icon = NAV.find((n) => n.id === view)!.icon;
  return (
    <div className="fr-empty">
      <div className="fr-empty__art" aria-hidden>
        <span className="fr-empty__sticky fr-empty__sticky--a" />
        <span className="fr-empty__sticky fr-empty__sticky--b" />
        <span className="fr-empty__badge">{query ? <Search size={22} /> : <Icon size={22} />}</span>
      </div>
      <h2 className="fr-empty__title">{content.title}</h2>
      <p className="fr-empty__body">{content.body}</p>
      {!query && !filtered && (view === 'home' || view === 'mine') ? (
        <Button variant="primary" icon={Plus} loading={creating} onClick={onCreate}>
          New board
        </Button>
      ) : null}
    </div>
  );
}

function RenameModal({
  board,
  onClose,
  onRenamed,
}: {
  board: BoardSummary | null;
  onClose: () => void;
  onRenamed: (b: BoardSummary) => void;
}) {
  const notify = useToast();
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (board) {
      setTitle(board.title);
      setError(null);
    }
  }, [board]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!board) return;
    const t = title.trim();
    if (!t) return setError('Give your board a name');
    if (t.length > 120) return setError('Keep it under 120 characters');
    if (t === board.title) return onClose();
    setSaving(true);
    try {
      const { board: updated } = await api.updateBoard(board.id, { title: t });
      onRenamed(updated);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : 'Could not rename the board', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={!!board}
      onClose={onClose}
      title="Rename board"
      width={420}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={saving} onClick={() => submit()}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} noValidate>
        <Input
          aria-label="Board name"
          value={title}
          maxLength={120}
          onChange={(e) => {
            setTitle(e.target.value);
            setError(null);
          }}
          onFocus={(e) => e.target.select()}
          error={error ?? undefined}
        />
      </form>
    </Modal>
  );
}

function ConfirmModal({
  open,
  title,
  body,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const notify = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      width={420}
      footer={
        <>
          <Button onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                onClose();
              } catch (e) {
                notify(e instanceof ApiError ? e.message : 'Something went wrong', 'error');
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--fr-ink-2)' }}>{body}</p>
    </Modal>
  );
}
