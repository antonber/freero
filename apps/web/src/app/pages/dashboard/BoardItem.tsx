import { memo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Crown, Ellipsis, Folder, FolderInput, FolderLock, House, LogOut, Pencil, Share2, SquareArrowOutUpRight, Star, Trash } from 'lucide-react';
import type { BoardSummary, ProjectSummary } from '@freero/shared';
import { Avatar, IconButton, Menu, type MenuItem } from '@ui';
import { BoardThumb } from './BoardThumb';
import { BOARD_DRAG_TYPE } from './Sidebar';
import { boardTime, type BoardSort } from '../../lib/boards';
import { relativeTime } from '../../lib/time';
import { personColor } from '../../lib/placeholder';

export interface BoardActions {
  open(b: BoardSummary): void;
  rename(b: BoardSummary): void;
  duplicate(b: BoardSummary): void;
  toggleStar(b: BoardSummary): void;
  share(b: BoardSummary): void;
  remove(b: BoardSummary): void;
  leave(b: BoardSummary): void;
  /** Into a project of the board's workspace (null: the workspace root). */
  move(b: BoardSummary, projectId: string | null): void;
  transfer(b: BoardSummary): void;
  describe(b: BoardSummary, description: string): void;
}

interface Props {
  board: BoardSummary;
  layout: 'grid' | 'list';
  sort: BoardSort;
  userId: string;
  actions: BoardActions;
  /** Projects of the current workspace (offered by "Move to" for its boards). */
  projects: readonly ProjectSummary[];
  /** The current workspace (boards shared from elsewhere can't move into its projects). */
  workspaceId: string | null;
}

export function boardMenuItems(b: BoardSummary, actions: BoardActions, projects: readonly ProjectSummary[] = [], workspaceId: string | null = null): MenuItem[] {
  const canEdit = b.role === 'owner' || b.role === 'editor';
  const movable = b.permissions.canMove && b.workspaceId === workspaceId;
  return [
    { id: 'open', label: 'Open', icon: SquareArrowOutUpRight, onSelect: () => actions.open(b) },
    { id: 'rename', label: 'Rename', icon: Pencil, disabled: !canEdit, disabledReason: 'Only editors can rename this board', onSelect: () => actions.rename(b) },
    {
      id: 'duplicate',
      label: 'Duplicate',
      icon: Copy,
      disabled: !b.permissions.canExport,
      disabledReason: 'This workspace doesn’t allow copying its boards',
      onSelect: () => actions.duplicate(b),
    },
    { id: 'star', label: b.starred ? 'Remove from starred' : 'Star', icon: Star, onSelect: () => actions.toggleStar(b) },
    { id: 'share', label: 'Share', icon: Share2, onSelect: () => actions.share(b) },
    ...(movable
      ? [
          {
            id: 'move',
            label: 'Move to',
            icon: FolderInput,
            onSelect: () => undefined,
            submenu: [
              { id: 'move-root', label: 'No project', icon: House, checked: b.projectId === null, onSelect: () => actions.move(b, null) },
              ...projects.map((p) => ({
                id: `move-${p.id}`,
                label: p.name,
                icon: p.access === 'private' ? FolderLock : Folder,
                checked: b.projectId === p.id,
                onSelect: () => actions.move(b, p.id),
              })),
            ],
          } satisfies MenuItem,
        ]
      : []),
    ...(b.permissions.canTransfer ? [{ id: 'transfer', label: 'Transfer ownership…', icon: Crown, onSelect: () => actions.transfer(b) } satisfies MenuItem] : []),
    { divider: true },
    b.role === 'owner'
      ? { id: 'delete', label: 'Delete', icon: Trash, danger: true, onSelect: () => actions.remove(b) }
      : { id: 'leave', label: 'Leave board', icon: LogOut, danger: true, onSelect: () => actions.leave(b) },
  ];
}

/** The card's description: shown under the title, edited in place by editors (Enter saves, Esc cancels). */
function Description({ board: b, actions }: { board: BoardSummary; actions: BoardActions }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const canEdit = b.role === 'owner' || b.role === 'editor';
  if (editing)
    return (
      <textarea
        className="fr-dash-card__desc-input"
        aria-label={`Description of ${b.title || 'Untitled board'}`}
        value={draft}
        maxLength={2000}
        rows={2}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (draft.trim() !== b.description) actions.describe(b, draft.trim());
        }}
        onKeyDown={(e: KeyboardEvent<HTMLTextAreaElement>) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            setDraft(b.description);
            setEditing(false);
          }
        }}
      />
    );
  if (!canEdit) return b.description ? <p className="fr-dash-card__desc">{b.description}</p> : null;
  return (
    <button
      type="button"
      className={`fr-dash-card__desc fr-dash-card__desc--edit${b.description ? '' : ' fr-dash-card__desc--empty'}`}
      aria-label={b.description ? `Edit description: ${b.description}` : 'Add a description'}
      onClick={() => {
        setDraft(b.description);
        setEditing(true);
      }}
    >
      {b.description || 'Add a description'}
    </button>
  );
}

export const BoardItem = memo(function BoardItem({ board: b, layout, sort, userId, actions, projects, workspaceId }: Props) {
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const time = boardTime(b, sort);
  const owner = b.ownerId === userId ? 'You' : b.ownerName;
  const title = b.title || 'Untitled board';
  const draggable = b.permissions.canMove && b.workspaceId === workspaceId;
  const drag = draggable
    ? {
        draggable: true,
        onDragStart: (e: DragEvent) => {
          e.dataTransfer.setData(BOARD_DRAG_TYPE, b.id);
          e.dataTransfer.effectAllowed = 'move';
        },
      }
    : {};

  const star = (
    <IconButton
      size={32}
      icon={<Star size={17} fill={b.starred ? 'currentColor' : 'none'} />}
      label={b.starred ? 'Unstar' : 'Star'}
      active={b.starred}
      className={`fr-board__star${b.starred ? ' fr-board__star--on' : ''}`}
      tooltipSide="top"
      onClick={() => actions.toggleStar(b)}
    />
  );
  const more = (
    <>
      <IconButton
        ref={menuBtn}
        size={32}
        icon={Ellipsis}
        label="Board actions"
        tooltipSide="top"
        className="fr-board__more"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((o) => !o)}
      />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={menuBtn.current}
        align="end"
        items={boardMenuItems(b, actions, projects, workspaceId)}
        aria-label={`Actions for ${title}`}
      />
    </>
  );

  if (layout === 'list') {
    return (
      <div className={`fr-row${menuOpen ? ' fr-row--active' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }} {...drag}>
        <Link to={`/board/${b.id}`} className="fr-board__link" aria-label={`Open ${title}`} draggable={false} />
        <div className="fr-row__thumb">
          <BoardThumb board={b} />
        </div>
        <div className="fr-row__title" title={b.description ? `${title} — ${b.description}` : title}>
          {title}
        </div>
        <div className="fr-row__owner">
          <Avatar name={b.ownerName} color={personColor(b.ownerId)} size={20} />
          <span>{owner}</span>
        </div>
        <div className="fr-row__time">{relativeTime(time.at)}</div>
        <div className="fr-row__actions">
          {star}
          {more}
        </div>
      </div>
    );
  }

  return (
    <div className={`fr-dash-card${menuOpen ? ' fr-dash-card--active' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }} {...drag}>
      <Link to={`/board/${b.id}`} className="fr-board__link" aria-label={`Open ${title}`} draggable={false} />
      <div className="fr-dash-card__thumb">
        <BoardThumb board={b} />
        <div className="fr-dash-card__hover-actions">
          {star}
          {more}
        </div>
      </div>
      <div className="fr-dash-card__meta">
        <div className="fr-dash-card__title" title={title}>
          {title}
        </div>
        <Description board={b} actions={actions} />
        <div className="fr-dash-card__sub">
          <span className="fr-dash-card__owner">{owner}</span>
          <span aria-hidden>·</span>
          <span>
            {time.label} {relativeTime(time.at)}
          </span>
        </div>
      </div>
    </div>
  );
});
