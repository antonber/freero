import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArchiveRestore, Folder, LayoutGrid, LayoutTemplate, List, Plus, RotateCw, Search, ShieldCheck, UserX, X } from 'lucide-react';
import { TRASH_RETENTION_DAYS, type BoardSummary, type ProjectSummary, type WorkspaceBlock } from '@freero/shared';
import { Button, IconButton, Input, Kbd, Modal, SegmentedControl, Select, Skeleton, Spinner, useToast } from '@ui';
import { api, ApiError, type BoardFilter } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ShareDialog } from '../../components/ShareDialog';
import { VerifyEmailBanner } from '../../components/VerifyEmailBanner';
import { NotificationBell } from '../../notifications/NotificationBell';
import { filterByOwner, sortBoards, type BoardSort, type OwnerFilter } from '../../lib/boards';
import { useDebouncedValue, usePersistentState } from '../../lib/hooks';
import { onLaunchedBackup, takeBackup } from '../../lib/pendingBackup';
import { BoardItem, type BoardActions } from './BoardItem';
import { ContentSearch, useContentSearch } from './ContentSearch';
import { RecentActivity } from './RecentActivity';
import { RestoreBackupDialog } from './RestoreBackupDialog';
import { NAV, Sidebar, type BoardView, type View } from './Sidebar';
import { TrashItem, type TrashActions } from './TrashItem';
import { CreateWorkspaceDialog, ProjectDialog, TransferBoardDialog } from './WorkspaceDialogs';
import { WorkspaceMembers } from './WorkspaceMembers';
import { WorkspaceSettings } from './WorkspaceSettings';
import { WorkspaceBlockedNotice } from './WorkspaceBlockedNotice';
import { useWorkspaces, workspaceLabel } from './useWorkspaces';
import './dashboard.css';
import './workspaces.css';

const VIEW_FILTER: Record<BoardView | 'project', BoardFilter> = {
  home: 'all',
  recent: 'recent',
  starred: 'starred',
  shared: 'shared',
  mine: 'mine',
  trash: 'trash',
  project: 'all',
};
const VIEWS: View[] = ['home', 'recent', 'starred', 'shared', 'mine', 'trash', 'project', 'members', 'settings'];
const VIEW_TITLE: Record<BoardView, string> = {
  home: 'All boards',
  recent: 'Recently opened',
  starred: 'Starred',
  shared: 'Shared with me',
  mine: 'My boards',
  trash: 'Trash',
};
const SORTS = ['opened', 'modified', 'name'] as const;
const LAYOUTS = ['grid', 'list'] as const;
const SEARCH_IN = ['names', 'content'] as const;

const EMPTY: Record<BoardView | 'project', { title: string; body: string }> = {
  home: { title: 'Your canvas is waiting', body: 'Create your first board to sketch, plan and brainstorm with your team.' },
  recent: { title: 'Nothing opened yet', body: 'Boards you open will line up here so you can jump right back in.' },
  starred: { title: 'No starred boards', body: 'Star the boards you use most to keep them one click away.' },
  shared: { title: 'Nothing shared with you yet', body: 'Boards people share with you from outside your workspaces show up here.' },
  mine: { title: 'You haven’t created a board yet', body: 'Start a blank board or pick a template to get going.' },
  trash: { title: 'Trash is empty', body: `Boards you delete stay here for ${TRASH_RETENTION_DAYS} days, so you can restore them.` },
  project: { title: 'This project is empty', body: 'Create a board here, or drag boards onto the project in the sidebar.' },
};

const UNTITLED = 'Untitled board';

export function DashboardPage() {
  const { user } = useAuth();
  const notify = useToast();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const rawView = params.get('view') as View | null;
  const view: View = rawView && VIEWS.includes(rawView) ? rawView : 'home';
  const projectId = view === 'project' ? params.get('project') : null;
  const ws = useWorkspaces(params.get('ws'));
  const workspace = ws.current;
  const project = projectId ? (ws.projects.find((p) => p.id === projectId) ?? null) : null;
  const boardView: BoardView | 'project' | null = view === 'members' || view === 'settings' ? null : view;

  const [query, setQuery] = useState('');
  const q = useDebouncedValue(query.trim(), 250);
  const [layout, setLayout] = usePersistentState<'grid' | 'list'>('fr.dashboard.layout', 'grid', LAYOUTS);
  const [sort, setSort] = usePersistentState<BoardSort>('fr.dashboard.sort', 'opened', SORTS);
  const [owner, setOwner] = useState<OwnerFilter>('any');
  // Board names (the list below, filtered) or what the boards say (KAI-141).
  const [searchIn, setSearchIn] = usePersistentState<(typeof SEARCH_IN)[number]>('fr.dashboard.searchIn', 'names', SEARCH_IN);

  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [creating, setCreating] = useState<'blank' | 'template' | null>(null);
  const reqId = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  // dialogs
  const [renaming, setRenaming] = useState<BoardSummary | null>(null);
  const [deleting, setDeleting] = useState<BoardSummary | null>(null);
  const [leaving, setLeaving] = useState<BoardSummary | null>(null);
  const [purging, setPurging] = useState<BoardSummary | null>(null);
  const [sharing, setSharing] = useState<BoardSummary | null>(null);
  const [transferring, setTransferring] = useState<BoardSummary | null>(null);
  const [newWorkspace, setNewWorkspace] = useState(false);
  const [editingProject, setEditingProject] = useState<ProjectSummary | 'new' | null>(null);
  const [deletingProject, setDeletingProject] = useState<ProjectSummary | null>(null);
  // Restoring a .freero backup (KAI-137): from the tile, a file dropped on a board, or one the
  // installed app was opened with (KAI-218).
  const [restoring, setRestoring] = useState<{ file: File | null } | null>(null);
  const wantsRestore = params.get('restore') === '1';
  useEffect(() => {
    if (!wantsRestore) return;
    setRestoring({ file: takeBackup() });
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('restore');
      return next;
    }, { replace: true });
  }, [wantsRestore, setParams]);
  useEffect(() => onLaunchedBackup((file) => setRestoring({ file })), []);

  useEffect(() => {
    document.title = workspace ? `${workspaceLabel(workspace)} · Freero` : 'Boards · Freero';
  }, [workspace]);

  const workspaceId = workspace?.id ?? null;
  const load = useCallback(async () => {
    if (!boardView || !workspaceId) return;
    const id = ++reqId.current;
    setLoadFailed(false);
    try {
      const { boards } = await api.listBoards(VIEW_FILTER[boardView], q, { workspace: workspaceId, project: projectId ?? undefined });
      if (id === reqId.current) setBoards(boards);
    } catch (e) {
      if (id !== reqId.current) return;
      setLoadFailed(true);
      setBoards((b) => b ?? []);
      notify(e instanceof ApiError ? e.message : 'Could not load your boards', 'error');
    }
  }, [boardView, workspaceId, projectId, q, notify]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the skeleton when switching views or workspaces (not when searching, to avoid flashes).
  useEffect(() => {
    setBoards(null);
    setOwner('any');
  }, [view, workspaceId, projectId]);

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

  /** Navigates within the current workspace (keeps `ws` in the URL so links and reloads land here). */
  const go = useCallback(
    (v: View, extra: Record<string, string> = {}, wsId = workspaceId) => {
      setQuery('');
      const next: Record<string, string> = { ...(wsId ? { ws: wsId } : {}), ...extra };
      if (v !== 'home') next.view = v;
      setParams(next);
    },
    [setParams, workspaceId],
  );
  const setView = (v: View) => go(v);

  const patchBoard = useCallback((id: string, patch: Partial<BoardSummary>) => {
    setBoards((list) => list?.map((b) => (b.id === id ? { ...b, ...patch } : b)) ?? null);
  }, []);

  const create = async (kind: 'blank' | 'template') => {
    if (creating || !workspace) return;
    setCreating(kind);
    try {
      const { board } = await api.createBoard({ title: UNTITLED, workspaceId: workspace.id, projectId: project?.id ?? null });
      navigate(`/board/${board.id}${kind === 'template' ? '?dock=templates' : ''}`);
    } catch (e) {
      notify(e instanceof ApiError ? e.message : 'Could not create a board', 'error');
      setCreating(null);
    }
  };

  const moveBoard = useCallback(
    async (boardId: string, target: string | null) => {
      const current = boards?.find((b) => b.id === boardId);
      if (current && current.projectId === target) return;
      try {
        const { board } = await api.updateBoard(boardId, { projectId: target });
        // In a project view, a board moved elsewhere leaves the list.
        if (projectId && board.projectId !== projectId) setBoards((list) => list?.filter((x) => x.id !== boardId) ?? null);
        else patchBoard(boardId, { projectId: board.projectId });
        const name = target ? (ws.projects.find((p) => p.id === target)?.name ?? 'the project') : 'No project';
        notify(`Moved “${board.title || UNTITLED}” to ${name}`, 'success');
      } catch (e) {
        notify(e instanceof ApiError ? e.message : 'Could not move the board', 'error');
      }
    },
    [boards, projectId, ws.projects, patchBoard, notify],
  );

  // Stable action handlers so memoized cards don't re-render on every keystroke.
  const viewRef = useRef(view);
  viewRef.current = view;
  const moveRef = useRef(moveBoard);
  moveRef.current = moveBoard;
  const actions = useMemo<BoardActions>(
    () => ({
      open: (b) => navigate(`/board/${b.id}`),
      rename: (b) => setRenaming(b),
      share: (b) => setSharing(b),
      remove: (b) => setDeleting(b),
      leave: (b) => setLeaving(b),
      transfer: (b) => setTransferring(b),
      move: (b, target) => void moveRef.current(b.id, target),
      describe: async (b, description) => {
        patchBoard(b.id, { description });
        try {
          await api.updateBoard(b.id, { description });
        } catch (e) {
          patchBoard(b.id, { description: b.description });
          notify(e instanceof ApiError ? e.message : 'Could not save the description', 'error');
        }
      },
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

  const trashActions = useMemo<TrashActions>(
    () => ({
      restore: async (b) => {
        try {
          await api.restoreBoard(b.id);
          setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
          notify(`Restored “${b.title || UNTITLED}”`, 'success', {
            action: { label: 'Open', onClick: () => navigate(`/board/${b.id}`) },
          });
        } catch (e) {
          notify(e instanceof ApiError ? e.message : 'Could not restore the board', 'error');
        }
      },
      deleteForever: (b) => setPurging(b),
    }),
    [navigate, notify],
  );

  if (!user) return null;

  const trash = view === 'trash';
  // The trash keeps the server's order (most recently deleted first).
  const visible = boards ? (trash ? boards : sortBoards(filterByOwner(boards, owner, user.id), sort)) : null;
  // Guests can't create boards here, nor can anyone the workspace closed its boards to (deactivated, two-step required).
  const guest = workspace?.role === 'guest';
  const mayCreate = !guest && !workspace?.blocked;
  const showCreate = mayCreate && (view === 'home' || view === 'mine' || (view === 'project' && !!project));
  const showOwnerTabs = view === 'home' || view === 'recent' || view === 'starred' || view === 'project';
  const searching = q.length > 0;
  const contentSearch = useContentSearch(searching && !trash && boardView !== null ? q : '', workspaceId);
  const inContent = searching && !trash && searchIn === 'content';
  const title = view === 'project' ? (project?.name ?? 'Project') : boardView ? VIEW_TITLE[boardView as BoardView] : '';

  const sidebar = (
    <Sidebar
      view={view}
      onView={setView}
      workspaces={ws.workspaces}
      current={workspace}
      onSwitchWorkspace={(id) => go('home', {}, id)}
      onCreateWorkspace={() => setNewWorkspace(true)}
      projects={ws.projects}
      projectId={projectId}
      onProject={(id) => go('project', { project: id })}
      onCreateProject={() => setEditingProject('new')}
      onManageProject={(p) => setEditingProject(p)}
      onDeleteProject={(p) => setDeletingProject(p)}
      onDropBoard={(id, target) => void moveBoard(id, target)}
    />
  );

  return (
    <div className="fr-dash">
      {sidebar}

      <main className="fr-dash__main">
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
          <div className="fr-dash__actions">
            <NotificationBell />
            {!mayCreate ? null : (
              <Button variant="primary" icon={Plus} loading={creating === 'blank'} onClick={() => create('blank')}>
                New board
              </Button>
            )}
          </div>
        </header>

        <div className="fr-dash__scroll">
          <VerifyEmailBanner />
          {workspace?.blocked ? <WorkspaceBlockedNotice workspace={workspace} /> : null}
          {view === 'members' && workspace ? (
            <WorkspaceMembers
              key={workspace.id}
              workspace={workspace}
              onChanged={() => void ws.reload()}
              onLeft={() => {
                void ws.reload();
                go('home', {}, null);
              }}
            />
          ) : view === 'settings' && workspace ? (
            <WorkspaceSettings
              key={workspace.id}
              workspace={workspace}
              onChanged={() => void ws.reload()}
              onDeleted={() => {
                void ws.reload();
                go('home', {}, null);
              }}
            />
          ) : (
          <>
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
              <button type="button" className="fr-create__tile fr-create__tile--restore" onClick={() => setRestoring({ file: null })} disabled={!!creating}>
                <span className="fr-create__icon">
                  <ArchiveRestore size={22} />
                </span>
                <span className="fr-create__text">
                  <span className="fr-create__title">Restore backup</span>
                  <span className="fr-create__sub">From a .freero file</span>
                </span>
              </button>
            </section>
          ) : null}

          <section className="fr-collection" aria-label={title}>
            <div className="fr-collection__head">
              <h1 className="fr-collection__title">
                {searching ? `Results for “${q}”` : title}
                {inContent ? null : visible ? <span className="fr-collection__count">{visible.length}</span> : null}
              </h1>
              <div className="fr-collection__controls">
                {searching && !trash ? (
                  <div className="fr-tabs fr-dash-search__in" role="tablist" aria-label="Search in">
                    {(
                      [
                        ['names', 'Board names', visible ? String(visible.length) : null],
                        ['content', 'Inside boards', contentSearch.hits ? `${contentSearch.hits.length}${contentSearch.cursor ? '+' : ''}` : null],
                      ] as const
                    ).map(([id, label, count]) => (
                      <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={searchIn === id}
                        className={`fr-tab${searchIn === id ? ' fr-tab--on' : ''}`}
                        onClick={() => setSearchIn(id)}
                      >
                        {label}
                        {count !== null ? <span className="fr-dash-search__tab-count">{count}</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
                {showOwnerTabs && !inContent ? (
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
                {trash || inContent ? null : (
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
                )}
                {inContent ? null : (
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
                )}
              </div>
            </div>

            {inContent ? (
              <ContentSearch q={q} search={contentSearch} />
            ) : visible === null ? (
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
              <EmptyState view={boardView ?? 'home'} canCreate={showCreate} guest={guest} blocked={workspace?.blocked ?? null} query={q} filtered={owner !== 'any' && (boards?.length ?? 0) > 0} onCreate={() => create('blank')} creating={creating === 'blank'} />
            ) : trash ? (
              layout === 'grid' ? (
                <div className="fr-dash-grid">
                  {visible.map((b) => (
                    <TrashItem key={b.id} board={b} layout="grid" actions={trashActions} />
                  ))}
                </div>
              ) : (
                <div className="fr-list fr-dash-trash__list" role="list">
                  <div className="fr-list__head" aria-hidden>
                    <span />
                    <span>Name</span>
                    <span>Deleted</span>
                    <span>Restorable for</span>
                    <span />
                  </div>
                  {visible.map((b) => (
                    <TrashItem key={b.id} board={b} layout="list" actions={trashActions} />
                  ))}
                </div>
              )
            ) : layout === 'grid' ? (
              <div className="fr-dash-grid">
                {visible.map((b) => (
                  <BoardItem key={b.id} board={b} layout="grid" sort={sort} userId={user.id} actions={actions} projects={ws.projects} workspaceId={workspaceId} />
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
                  <BoardItem key={b.id} board={b} layout="list" sort={sort} userId={user.id} actions={actions} projects={ws.projects} workspaceId={workspaceId} />
                ))}
              </div>
            )}
          </section>
          {view === 'home' && !searching && workspaceId ? <RecentActivity workspaceId={workspaceId} /> : null}
          </>
          )}
        </div>
      </main>

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
        body={`It will be removed for everyone with access and moved to your Trash, where you can restore it for ${TRASH_RETENTION_DAYS} days.`}
        confirmLabel="Move to trash"
        onClose={() => setDeleting(null)}
        onConfirm={async () => {
          const b = deleting!;
          await api.deleteBoard(b.id);
          setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
          notify('Board moved to the trash', 'info', {
            action: {
              label: 'Undo',
              onClick: async () => {
                try {
                  await api.restoreBoard(b.id);
                  void load();
                } catch (e) {
                  notify(e instanceof ApiError ? e.message : 'Could not restore the board', 'error');
                }
              },
            },
          });
        }}
      />
      <ConfirmModal
        open={!!purging}
        title={`Delete “${purging?.title || UNTITLED}” forever?`}
        body="The board and everything on it will be gone for good. This can’t be undone."
        confirmLabel="Delete forever"
        onClose={() => setPurging(null)}
        onConfirm={async () => {
          const b = purging!;
          await api.deleteBoardForever(b.id);
          setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
          notify('Board deleted forever', 'info');
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
      <TransferBoardDialog
        board={transferring}
        workspace={workspace}
        onClose={() => setTransferring(null)}
        onTransferred={(b) => {
          setTransferring(null);
          if (b.workspaceId !== workspaceId) setBoards((list) => list?.filter((x) => x.id !== b.id) ?? null);
          else patchBoard(b.id, b);
        }}
      />
      {restoring ? (
        <RestoreBackupDialog
          open
          initialFile={restoring.file}
          workspaces={ws.workspaces ?? []}
          workspaceId={workspaceId}
          projectId={project?.id ?? null}
          onClose={() => setRestoring(null)}
          onRestored={(id, note) => {
            setRestoring(null);
            notify(note, 'success');
            navigate(`/board/${id}`);
          }}
        />
      ) : null}
      <CreateWorkspaceDialog
        open={newWorkspace}
        onClose={() => setNewWorkspace(false)}
        onCreated={(w) => {
          setNewWorkspace(false);
          void ws.reload().then(() => go('members', {}, w.id));
          notify(`Created ${w.name}. Invite your team next.`, 'success');
        }}
      />
      {workspace ? (
        <ProjectDialog
          open={editingProject !== null}
          workspace={workspace}
          project={editingProject === 'new' ? null : editingProject}
          onClose={() => setEditingProject(null)}
          onSaved={(p) => {
            const created = editingProject === 'new';
            setEditingProject(null);
            void ws.reloadProjects();
            if (created) go('project', { project: p.id });
          }}
        />
      ) : null}
      <ConfirmModal
        open={!!deletingProject}
        title={`Delete the project “${deletingProject?.name ?? ''}”?`}
        body="Only empty projects can be deleted: move its boards out first. Boards are never deleted with a project."
        confirmLabel="Delete project"
        onClose={() => setDeletingProject(null)}
        onConfirm={async () => {
          const p = deletingProject!;
          await api.deleteProject(p.id);
          await ws.reloadProjects();
          if (projectId === p.id) go('home');
          notify('Project deleted', 'info');
        }}
      />
      {sharing ? (
        <ShareDialog
          boardId={sharing.id}
          board={sharing}
          open
          onClose={() => setSharing(null)}
          onBoardChange={(b) => patchBoard(b.id, { linkAccess: b.linkAccess, permissions: b.permissions })}
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
  canCreate,
  guest,
  blocked,
  query,
  filtered,
  onCreate,
  creating,
}: {
  view: BoardView | 'project';
  canCreate: boolean;
  guest: boolean;
  /** The workspace closed its boards to you: say what to do instead of inviting you to create one (KAI-193). */
  blocked: WorkspaceBlock | null;
  query: string;
  filtered: boolean;
  onCreate: () => void;
  creating: boolean;
}) {
  const closed = blocked && (view === 'home' || view === 'mine' || view === 'project');
  const content = query
    ? { title: `No boards match “${query}”`, body: 'Try a different word, or check another section.' }
    : closed
      ? blocked === 'two_factor_required'
        ? { title: 'Turn on two-step verification to work here', body: 'This workspace requires it. Once it’s on, you can open and create its boards.' }
        : { title: 'Your access here is paused', body: 'An admin of this workspace deactivated you. Ask them to reactivate you to open and create its boards.' }
    : filtered
      ? { title: 'No boards here', body: 'Nothing matches this owner filter. Try “All”.' }
      : guest && (view === 'home' || view === 'project')
        ? { title: 'Nothing shared with you here yet', body: 'You’re a guest in this workspace: boards and projects people share with you show up here.' }
        : EMPTY[view];
  const navigate = useNavigate();
  const Icon = closed ? (blocked === 'two_factor_required' ? ShieldCheck : UserX) : (NAV.find((n) => n.id === view)?.icon ?? Folder);
  return (
    <div className="fr-empty">
      <div className="fr-empty__art" aria-hidden>
        <span className="fr-empty__sticky fr-empty__sticky--a" />
        <span className="fr-empty__sticky fr-empty__sticky--b" />
        <span className="fr-empty__badge">{query ? <Search size={22} /> : <Icon size={22} />}</span>
      </div>
      <h2 className="fr-empty__title">{content.title}</h2>
      <p className="fr-empty__body">{content.body}</p>
      {!query && closed && blocked === 'two_factor_required' ? (
        <Button variant="primary" icon={ShieldCheck} onClick={() => navigate('/settings#two-factor')}>
          Turn on two-step verification
        </Button>
      ) : null}
      {!query && !filtered && !closed && canCreate ? (
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
