import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ChevronsUpDown,
  Clock,
  Ellipsis,
  Folder,
  FolderLock,
  House,
  LogOut,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Star,
  Trash2,
  UserRound,
  Users,
} from 'lucide-react';
import type { ProjectSummary, WorkspaceSummary } from '@freero/shared';
import { Avatar, IconButton, Logo, Menu, Tooltip } from '@ui';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useMediaQuery } from '../../lib/hooks';
import { personColor } from '../../lib/placeholder';
import { workspaceLabel } from './useWorkspaces';

export type BoardView = 'home' | 'recent' | 'starred' | 'shared' | 'mine' | 'trash';
/** Board collections, a project's boards, or a team's members / settings page. */
export type View = BoardView | 'project' | 'members' | 'settings';

export const NAV: { id: BoardView; label: string; icon: typeof House }[] = [
  { id: 'home', label: 'Home', icon: House },
  { id: 'recent', label: 'Recent', icon: Clock },
  { id: 'starred', label: 'Starred', icon: Star },
  { id: 'shared', label: 'Shared with me', icon: Users },
  { id: 'mine', label: 'My boards', icon: Folder },
  { id: 'trash', label: 'Trash', icon: Trash2 },
];

/** Drag payload of a dashboard board card (dropped on a project to move it there). */
export const BOARD_DRAG_TYPE = 'application/x-freero-board';

export interface SidebarProps {
  view: View;
  onView: (v: View) => void;
  workspaces: WorkspaceSummary[] | null;
  current: WorkspaceSummary | null;
  onSwitchWorkspace: (id: string) => void;
  onCreateWorkspace: () => void;
  projects: ProjectSummary[];
  projectId: string | null;
  onProject: (id: string) => void;
  onCreateProject: () => void;
  onManageProject: (p: ProjectSummary) => void;
  onDeleteProject: (p: ProjectSummary) => void;
  /** A board card was dropped on a project (null: the workspace root). */
  onDropBoard: (boardId: string, projectId: string | null) => void;
}

export function WorkspaceBadge({ workspace, size = 28 }: { workspace: WorkspaceSummary; size?: number }) {
  if (workspace.kind === 'personal')
    return (
      <span className="fr-dash-ws__badge fr-dash-ws__badge--personal" style={{ width: size, height: size }} aria-hidden>
        <UserRound size={Math.round(size * 0.55)} />
      </span>
    );
  return (
    <span className="fr-dash-ws__badge" style={{ width: size, height: size, background: personColor(workspace.id), fontSize: size * 0.46 }} aria-hidden>
      {workspace.name.trim().charAt(0).toUpperCase() || 'T'}
    </span>
  );
}

const ROLE_WORD: Record<WorkspaceSummary['role'], string> = { owner: 'Owner', admin: 'Admin', member: 'Member', guest: 'Guest' };

export function Sidebar(props: SidebarProps) {
  const { view, onView, workspaces, current, projects, projectId } = props;
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const accountRef = useRef<HTMLButtonElement>(null);
  const switcherRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const compact = useMediaQuery('(max-width: 1000px)');
  // Operators (moderation) get a way to the queue in their account menu.
  const [operator, setOperator] = useState(false);
  useEffect(() => {
    if (!user?.emailVerified) return;
    let live = true;
    api.moderationAccess().then(
      (r) => live && setOperator(r.operator),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [user?.id, user?.emailVerified]);
  if (!user) return null;
  const team = current?.kind === 'team';
  const guest = current?.role === 'guest';
  const manager = current?.role === 'owner' || current?.role === 'admin';

  return (
    <aside className="fr-sidebar">
      <Link to="/app" className="fr-sidebar__brand" aria-label="Freero home" onClick={() => onView('home')}>
        <Logo size={28} withWordmark />
      </Link>
      <Link to="/app" className="fr-sidebar__brand fr-sidebar__brand--compact" aria-label="Freero home" onClick={() => onView('home')}>
        <Logo size={30} />
      </Link>

      {current ? (
        <>
          <Tooltip content={workspaceLabel(current)} side="right" disabled={!compact}>
            <button
              ref={switcherRef}
              type="button"
              className={`fr-dash-ws${switcherOpen ? ' fr-dash-ws--open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={switcherOpen}
              aria-label={`Workspace: ${workspaceLabel(current)}. Switch workspace`}
              onClick={() => setSwitcherOpen((o) => !o)}
            >
              <WorkspaceBadge workspace={current} />
              <span className="fr-dash-ws__text">
                <span className="fr-dash-ws__name">{workspaceLabel(current)}</span>
                <span className="fr-dash-ws__meta">
                  {current.kind === 'personal' ? 'Just you' : `${ROLE_WORD[current.role]} · ${current.memberCount} ${current.memberCount === 1 ? 'member' : 'members'}`}
                </span>
              </span>
              <ChevronsUpDown className="fr-dash-ws__chev" size={15} aria-hidden />
            </button>
          </Tooltip>
          <Menu
            open={switcherOpen}
            onClose={() => setSwitcherOpen(false)}
            anchor={switcherRef.current}
            align="start"
            minWidth={240}
            aria-label="Workspaces"
            items={[
              { heading: 'Workspaces' },
              ...(workspaces ?? []).map((w) => ({
                id: `ws-${w.id}`,
                label: workspaceLabel(w),
                icon: <WorkspaceBadge workspace={w} size={18} />,
                checked: w.id === current.id,
                onSelect: () => props.onSwitchWorkspace(w.id),
              })),
              { divider: true },
              { id: 'new-ws', label: 'New team workspace…', icon: Plus, onSelect: props.onCreateWorkspace },
            ]}
          />
        </>
      ) : (
        <div className="fr-dash-ws fr-dash-ws--loading" aria-hidden />
      )}

      <nav className="fr-sidebar__nav" aria-label="Boards">
        {NAV.map((n) => (
          <Tooltip key={n.id} content={n.label} side="right" disabled={!compact}>
            <button
              type="button"
              className={`fr-nav${view === n.id ? ' fr-nav--active' : ''}`}
              aria-current={view === n.id ? 'page' : undefined}
              onClick={() => onView(n.id)}
              {...dropTarget(n.id === 'home' && !!current, () => props.onDropBoard, null)}
            >
              <n.icon size={18} aria-hidden />
              <span className="fr-nav__label">{n.label}</span>
            </button>
          </Tooltip>
        ))}
      </nav>

      {current ? (
        <section className="fr-dash-proj" aria-label="Projects">
          <div className="fr-dash-proj__head">
            <span className="fr-dash-proj__title">Projects</span>
            {/* Guests can't create projects, nor can anyone the workspace closed its boards to (KAI-193). */}
            {!guest && !current.blocked ? <IconButton size={32} icon={Plus} label="New project" tooltipSide="right" onClick={props.onCreateProject} /> : null}
          </div>
          {projects.length === 0 ? (
            <p className="fr-dash-proj__empty">{guest ? 'No projects shared with you' : 'Group boards into projects'}</p>
          ) : (
            <ul className="fr-dash-proj__list">
              {projects.map((p) => (
                <ProjectItem
                  key={p.id}
                  project={p}
                  active={view === 'project' && projectId === p.id}
                  compact={compact}
                  onOpen={() => props.onProject(p.id)}
                  onManage={() => props.onManageProject(p)}
                  onDelete={() => props.onDeleteProject(p)}
                  onDropBoard={props.onDropBoard}
                />
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {team && !guest && current?.blocked !== 'deactivated' ? (
        <nav className="fr-sidebar__nav fr-dash-ws__nav" aria-label="Workspace">
          <Tooltip content="Members" side="right" disabled={!compact}>
            <button type="button" className={`fr-nav${view === 'members' ? ' fr-nav--active' : ''}`} aria-current={view === 'members' ? 'page' : undefined} onClick={() => onView('members')}>
              <Users size={18} aria-hidden />
              <span className="fr-nav__label">Members</span>
            </button>
          </Tooltip>
          {manager ? (
            <Tooltip content="Workspace settings" side="right" disabled={!compact}>
              <button type="button" className={`fr-nav${view === 'settings' ? ' fr-nav--active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onView('settings')}>
                <SlidersHorizontal size={18} aria-hidden />
                <span className="fr-nav__label">Workspace settings</span>
              </button>
            </Tooltip>
          ) : null}
          {manager ? (
            <Tooltip content="Admin console" side="right" disabled={!compact}>
              <Link to={`/admin/${encodeURIComponent(current!.id)}`} className="fr-nav">
                <ShieldCheck size={18} aria-hidden />
                <span className="fr-nav__label">Admin console</span>
              </Link>
            </Tooltip>
          ) : null}
        </nav>
      ) : null}

      <div className="fr-sidebar__spacer" />

      <button
        ref={accountRef}
        type="button"
        className={`fr-account${menuOpen ? ' fr-account--open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="Account menu"
        onClick={() => setMenuOpen((o) => !o)}
      >
        <Avatar name={user.name} color={user.color} src={user.avatarUrl} size={32} />
        <span className="fr-account__text">
          <span className="fr-account__name">{user.name}</span>
          <span className="fr-account__email">{user.email}</span>
        </span>
        <ChevronsUpDown className="fr-account__chev" size={15} aria-hidden />
      </button>
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={accountRef.current}
        side="top"
        align="start"
        minWidth={220}
        aria-label="Account"
        items={[
          { heading: user.email },
          { id: 'settings', label: 'Account settings', icon: Settings, onSelect: () => navigate('/settings') },
          ...(operator ? [{ id: 'moderation', label: 'Moderation queue', icon: ShieldAlert, onSelect: () => navigate('/operator') }] : []),
          { divider: true },
          {
            id: 'logout',
            label: 'Log out',
            icon: LogOut,
            onSelect: async () => {
              await logout();
              navigate('/', { replace: true });
            },
          },
        ]}
      />
    </aside>
  );
}

/** Props that make an element accept dropped board cards (`enabled` false: none). */
function dropTarget(enabled: boolean, getDrop: () => SidebarProps['onDropBoard'], projectId: string | null) {
  if (!enabled) return {};
  const accepts = (e: DragEvent) => e.dataTransfer.types.includes(BOARD_DRAG_TYPE);
  return {
    onDragOver: (e: DragEvent<HTMLElement>) => {
      if (!accepts(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      e.currentTarget.classList.add('fr-dash-proj--drop');
    },
    onDragLeave: (e: DragEvent<HTMLElement>) => e.currentTarget.classList.remove('fr-dash-proj--drop'),
    onDrop: (e: DragEvent<HTMLElement>) => {
      e.currentTarget.classList.remove('fr-dash-proj--drop');
      const id = e.dataTransfer.getData(BOARD_DRAG_TYPE);
      if (!id) return;
      e.preventDefault();
      getDrop()(id, projectId);
    },
  };
}

function ProjectItem({
  project: p,
  active,
  compact,
  onOpen,
  onManage,
  onDelete,
  onDropBoard,
}: {
  project: ProjectSummary;
  active: boolean;
  compact: boolean;
  onOpen: () => void;
  onManage: () => void;
  onDelete: () => void;
  onDropBoard: SidebarProps['onDropBoard'];
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const Icon = p.access === 'private' ? FolderLock : Folder;
  return (
    <li className={`fr-dash-proj__item${active ? ' fr-dash-proj__item--active' : ''}`} {...dropTarget(true, () => onDropBoard, p.id)}>
      <Tooltip content={p.name} side="right" disabled={!compact}>
        <button type="button" className="fr-dash-proj__open" aria-current={active ? 'page' : undefined} onClick={onOpen}>
          <Icon size={17} aria-hidden />
          <span className="fr-dash-proj__name">{p.name}</span>
          {p.access === 'private' ? <span className="fr-dash-proj__private">Private</span> : null}
        </button>
      </Tooltip>
      {p.canManage ? (
        <>
          <IconButton
            ref={moreRef}
            size={32}
            icon={Ellipsis}
            label={`Project actions for ${p.name}`}
            tooltip={false}
            className="fr-dash-proj__more"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
          />
          <Menu
            open={open}
            onClose={() => setOpen(false)}
            anchor={moreRef.current}
            align="start"
            aria-label={`Actions for ${p.name}`}
            items={[
              { id: 'manage', label: 'Rename, access and people…', icon: SlidersHorizontal, onSelect: onManage },
              { divider: true },
              { id: 'delete', label: 'Delete project', icon: Trash2, danger: true, onSelect: onDelete },
            ]}
          />
        </>
      ) : null}
    </li>
  );
}
