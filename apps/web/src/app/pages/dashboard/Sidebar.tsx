import { useEffect, useRef, useState, type DragEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Archive,
  Building2,
  ChevronsUpDown,
  Clock,
  Ellipsis,
  Folder,
  FolderLock,
  FolderPlus,
  House,
  LayoutTemplate,
  LogOut,
  MessageSquareWarning,
  Monitor,
  Moon,
  Sun,
  Pin,
  PinOff,
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
import { PROJECT_MAX_DEPTH, type ProjectSummary, type WorkspaceSummary } from '@freero/shared';
import { Avatar, IconButton, Logo, Menu, Tooltip } from '@ui';
import { api } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { useChooseTheme } from '../../components/ThemeSwitch';
import { useThemePreference } from '../../lib/theme';
import { useMediaQuery } from '../../lib/hooks';
import { personColor } from '../../lib/placeholder';
import { workspaceLabel } from './useWorkspaces';
import { projectTree } from './projectTree';
import { PROBLEM_SHORTCUT, useProblemReport } from '../../problems/ProblemReport';

import { t as tr } from './messages';
export type BoardView = 'home' | 'recent' | 'starred' | 'shared' | 'mine' | 'trash' | 'archived';
/** Board collections, a project's boards, or a team's members / settings page. */
export type View = BoardView | 'project' | 'members' | 'settings';

export const NAV: { id: BoardView; label: string; icon: typeof House }[] = [
  { id: 'home', label: tr('home'), icon: House },
  { id: 'recent', label: tr('recent'), icon: Clock },
  { id: 'starred', label: tr('starred'), icon: Star },
  { id: 'shared', label: tr('sharedWithMe'), icon: Users },
  { id: 'mine', label: tr('myBoards'), icon: Folder },
  { id: 'archived', label: tr('archived'), icon: Archive },
  { id: 'trash', label: tr('trash'), icon: Trash2 },
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
  /** #129: a new project inside this one. */
  onCreateSubProject: (parent: ProjectSummary) => void;
  /** #161: a new project from a blueprint (inside `parent`, or at the top). */
  onUseBlueprint: (parent: ProjectSummary | null) => void;
  /** #161: save the project's boards and docs as a blueprint. */
  onSaveBlueprint: (p: ProjectSummary) => void;
  /** #129: pin / unpin a project at the top of your sidebar. */
  onPinProject: (p: ProjectSummary, pinned: boolean) => void;
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

const ROLE_WORD: Record<WorkspaceSummary['role'], string> = { owner: tr('owner'), admin: tr('admin'), member: tr('member'), guest: tr('guest') };

export function Sidebar(props: SidebarProps) {
  const { view, onView, workspaces, current, projects, projectId } = props;
  const { user, logout } = useAuth();
  const problems = useProblemReport();
  const navigate = useNavigate();
  const accountRef = useRef<HTMLButtonElement>(null);
  const switcherRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useThemePreference();
  const chooseTheme = useChooseTheme();
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
  const tree = projectTree(projects);
  const pinned = projects.filter((p) => p.pinned);
  const item = (p: ProjectSummary, depth: number, inPins: boolean) => (
    <ProjectItem
      key={`${inPins ? 'pin' : 'tree'}-${p.id}`}
      project={p}
      depth={depth}
      active={view === 'project' && projectId === p.id && !inPins}
      compact={compact}
      mayNest={!guest && !current?.blocked && depth + 1 < PROJECT_MAX_DEPTH}
      onOpen={() => props.onProject(p.id)}
      onManage={() => props.onManageProject(p)}
      onDelete={() => props.onDeleteProject(p)}
      onSubProject={() => props.onCreateSubProject(p)}
      onSaveBlueprint={guest || current?.blocked ? undefined : () => props.onSaveBlueprint(p)}
      onPin={(on) => props.onPinProject(p, on)}
      onDropBoard={props.onDropBoard}
    />
  );
  const team = current?.kind === 'team';
  const guest = current?.role === 'guest';
  const manager = current?.role === 'owner' || current?.role === 'admin';

  return (
    <aside className="fr-sidebar">
      <Link to="/app" className="fr-sidebar__brand" aria-label={tr('freeroHome')} onClick={() => onView('home')}>
        <Logo size={28} withWordmark />
      </Link>
      <Link to="/app" className="fr-sidebar__brand fr-sidebar__brand--compact" aria-label={tr('freeroHome')} onClick={() => onView('home')}>
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
              onClick={() => setSwitcherOpen((o) => !o)}
            >
              <WorkspaceBadge workspace={current} />
              {/* Named by what it shows (WCAG 2.5.3), then what it does. */}
              <span className="fr-sr-only">{tr('switchWorkspaceFrom')}</span>
              <span className="fr-dash-ws__text">
                <span className="fr-dash-ws__name">{workspaceLabel(current)}</span>
                <span className="fr-dash-ws__meta">
                  {current.kind === 'personal' ? tr('justYou') : `${ROLE_WORD[current.role]} · ${current.memberCount} ${current.memberCount === 1 ? 'member' : 'members'}`}
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
            aria-label={tr('workspaces')}
            items={[
              { heading: tr('workspaces') },
              ...(workspaces ?? []).map((w) => ({
                id: `ws-${w.id}`,
                label: workspaceLabel(w),
                icon: <WorkspaceBadge workspace={w} size={18} />,
                checked: w.id === current.id,
                onSelect: () => props.onSwitchWorkspace(w.id),
              })),
              { divider: true },
              { id: 'new-ws', label: tr('newTeamWorkspace'), icon: Plus, onSelect: props.onCreateWorkspace },
            ]}
          />
        </>
      ) : (
        <div className="fr-dash-ws fr-dash-ws--loading" aria-hidden />
      )}

      <nav className="fr-sidebar__nav" aria-label={tr('boards')}>
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
        <section className="fr-dash-proj" aria-label={tr('projects')}>
          <div className="fr-dash-proj__head">
            <span className="fr-dash-proj__title">{tr('projects')}</span>
            {/* Guests can't create projects, nor can anyone the workspace closed its boards to (KAI-193). */}
            {!guest && !current.blocked ? (
              <span className="fr-dash-proj__actions">
                <IconButton size={32} icon={LayoutTemplate} label={tr('newProjectFromABlueprint')} tooltipSide="right" onClick={() => props.onUseBlueprint(null)} />
                <IconButton size={32} icon={Plus} label={tr('newProject')} tooltipSide="right" onClick={props.onCreateProject} />
              </span>
            ) : null}
          </div>
          {projects.length === 0 ? (
            <p className="fr-dash-proj__empty">{guest ? tr('noProjectsSharedWithYou') : tr('groupBoardsIntoProjects')}</p>
          ) : (
            <>
              {pinned.length > 0 ? (
                <ul className="fr-dash-proj__list fr-dash-proj__list--pinned" aria-label={tr('pinnedProjects')}>
                  {pinned.map((p) => item(p, 0, true))}
                </ul>
              ) : null}
              <ul className="fr-dash-proj__list">{tree.map(({ project: p, depth }) => item(p, depth, false))}</ul>
            </>
          )}
        </section>
      ) : null}

      {team && !guest && current?.blocked !== 'deactivated' ? (
        <nav className="fr-sidebar__nav fr-dash-ws__nav" aria-label={tr('workspace')}>
          <Tooltip content={tr('members')} side="right" disabled={!compact}>
            <button type="button" className={`fr-nav${view === 'members' ? ' fr-nav--active' : ''}`} aria-current={view === 'members' ? 'page' : undefined} onClick={() => onView('members')}>
              <Users size={18} aria-hidden />
              <span className="fr-nav__label">{tr('members')}</span>
            </button>
          </Tooltip>
          {manager ? (
            <Tooltip content={tr('workspaceSettings')} side="right" disabled={!compact}>
              <button type="button" className={`fr-nav${view === 'settings' ? ' fr-nav--active' : ''}`} aria-current={view === 'settings' ? 'page' : undefined} onClick={() => onView('settings')}>
                <SlidersHorizontal size={18} aria-hidden />
                <span className="fr-nav__label">{tr('workspaceSettings')}</span>
              </button>
            </Tooltip>
          ) : null}
          {manager ? (
            <Tooltip content={tr('adminConsole')} side="right" disabled={!compact}>
              <Link to={`/admin/${encodeURIComponent(current!.id)}`} className="fr-nav">
                <ShieldCheck size={18} aria-hidden />
                <span className="fr-nav__label">{tr('adminConsole')}</span>
              </Link>
            </Tooltip>
          ) : null}
          {current?.organisation && (current.organisation.yourRole === 'owner' || current.organisation.yourRole === 'admin') ? (
            <Tooltip content={current.organisation.name} side="right" disabled={!compact}>
              <Link to={`/org/${encodeURIComponent(current.organisation.id)}`} className="fr-nav">
                <Building2 size={18} aria-hidden />
                <span className="fr-nav__label">{tr('organisation')}</span>
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
        onClick={() => setMenuOpen((o) => !o)}
      >
        <span className="fr-sr-only">{tr('accountMenu')}</span>
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
        aria-label={tr('account')}
        items={[
          { heading: user.email },
          { id: 'settings', label: tr('accountSettings'), icon: Settings, onSelect: () => navigate('/settings') },
          {
            id: 'theme',
            label: tr('theme'),
            icon: themeIcon[theme],
            onSelect: () => undefined,
            submenu: (['system', 'light', 'dark'] as const).map((t) => ({
              id: `theme-${t}`,
              label: t === 'system' ? tr('sameAsDevice') : t === 'light' ? tr('light') : tr('dark'),
              icon: themeIcon[t],
              checked: theme === t,
              onSelect: () => chooseTheme(t),
            })),
          },
          { id: 'problem', label: tr('reportAProblem'), icon: MessageSquareWarning, shortcut: PROBLEM_SHORTCUT, onSelect: () => problems.open() },
          ...(operator ? [{ id: 'moderation', label: tr('moderationQueue'), icon: ShieldAlert, onSelect: () => navigate('/operator') }] : []),
          { divider: true },
          {
            id: 'logout',
            label: tr('logOut'),
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

const themeIcon = { system: Monitor, light: Sun, dark: Moon } as const;

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
  depth,
  active,
  compact,
  mayNest,
  onOpen,
  onManage,
  onDelete,
  onSubProject,
  onSaveBlueprint,
  onPin,
  onDropBoard,
}: {
  project: ProjectSummary;
  depth: number;
  active: boolean;
  compact: boolean;
  /** You may make a sub-project here (not a guest, and room below it). */
  mayNest: boolean;
  onOpen: () => void;
  onManage: () => void;
  onDelete: () => void;
  onSubProject: () => void;
  onSaveBlueprint?: () => void;
  onPin: (pinned: boolean) => void;
  onDropBoard: SidebarProps['onDropBoard'];
}) {
  const moreRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const Icon = p.access === 'private' ? FolderLock : Folder;
  return (
    <li
      className={`fr-dash-proj__item${active ? ' fr-dash-proj__item--active' : ''}`}
      style={depth ? { paddingLeft: depth * 14 } : undefined}
      {...dropTarget(true, () => onDropBoard, p.id)}
    >
      <Tooltip content={p.name} side="right" disabled={!compact}>
        <button type="button" className="fr-dash-proj__open" aria-current={active ? 'page' : undefined} onClick={onOpen}>
          <Icon size={17} aria-hidden />
          <span className="fr-dash-proj__name">{p.name}</span>
          {p.access === 'private' ? <span className="fr-dash-proj__private">{tr('private')}</span> : null}
        </button>
      </Tooltip>
      <IconButton
        ref={moreRef}
        size={32}
        icon={Ellipsis}
        label={tr('projectActionsForName', { name: p.name })}
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
        aria-label={tr('actionsForName', { name: p.name })}
        items={[
          p.pinned
            ? { id: 'unpin', label: tr('unpinFromTheTop'), icon: PinOff, onSelect: () => onPin(false) }
            : { id: 'pin', label: tr('pinToTheTop'), icon: Pin, onSelect: () => onPin(true) },
          ...(mayNest ? [{ id: 'sub', label: tr('newSubProject'), icon: FolderPlus, onSelect: onSubProject }] : []),
          ...(onSaveBlueprint ? [{ id: 'blueprint', label: tr('saveAsBlueprint'), icon: LayoutTemplate, onSelect: onSaveBlueprint }] : []),
          ...(p.canManage
            ? [
                { id: 'manage', label: tr('settingsAccessAndPeople'), icon: SlidersHorizontal, onSelect: onManage },
                { divider: true as const },
                { id: 'delete', label: tr('deleteProject2'), icon: Trash2, danger: true, onSelect: onDelete },
              ]
            : []),
        ]}
      />
    </li>
  );
}
