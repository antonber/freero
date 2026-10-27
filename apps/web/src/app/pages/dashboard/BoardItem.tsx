import { memo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Ellipsis, LogOut, Pencil, Share2, SquareArrowOutUpRight, Star, Trash } from 'lucide-react';
import type { BoardSummary } from '@freero/shared';
import { Avatar, IconButton, Menu, type MenuItem } from '@ui';
import { BoardThumb } from './BoardThumb';
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
}

interface Props {
  board: BoardSummary;
  layout: 'grid' | 'list';
  sort: BoardSort;
  userId: string;
  actions: BoardActions;
}

export function boardMenuItems(b: BoardSummary, actions: BoardActions): MenuItem[] {
  const canEdit = b.role === 'owner' || b.role === 'editor';
  return [
    { id: 'open', label: 'Open', icon: SquareArrowOutUpRight, onSelect: () => actions.open(b) },
    { id: 'rename', label: 'Rename', icon: Pencil, disabled: !canEdit, onSelect: () => actions.rename(b) },
    { id: 'duplicate', label: 'Duplicate', icon: Copy, onSelect: () => actions.duplicate(b) },
    { id: 'star', label: b.starred ? 'Remove from starred' : 'Star', icon: Star, onSelect: () => actions.toggleStar(b) },
    { id: 'share', label: 'Share', icon: Share2, onSelect: () => actions.share(b) },
    { divider: true },
    b.role === 'owner'
      ? { id: 'delete', label: 'Delete', icon: Trash, danger: true, onSelect: () => actions.remove(b) }
      : { id: 'leave', label: 'Leave board', icon: LogOut, danger: true, onSelect: () => actions.leave(b) },
  ];
}

export const BoardItem = memo(function BoardItem({ board: b, layout, sort, userId, actions }: Props) {
  const menuBtn = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const time = boardTime(b, sort);
  const owner = b.ownerId === userId ? 'You' : b.ownerName;
  const title = b.title || 'Untitled board';

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
      <Menu open={menuOpen} onClose={() => setMenuOpen(false)} anchor={menuBtn.current} align="end" items={boardMenuItems(b, actions)} aria-label={`Actions for ${title}`} />
    </>
  );

  if (layout === 'list') {
    return (
      <div className={`fr-row${menuOpen ? ' fr-row--active' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}>
        <Link to={`/board/${b.id}`} className="fr-board__link" aria-label={`Open ${title}`} />
        <div className="fr-row__thumb">
          <BoardThumb board={b} />
        </div>
        <div className="fr-row__title" title={title}>
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
    <div className={`fr-card${menuOpen ? ' fr-card--active' : ''}`} onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}>
      <Link to={`/board/${b.id}`} className="fr-board__link" aria-label={`Open ${title}`} />
      <div className="fr-card__thumb">
        <BoardThumb board={b} />
        <div className="fr-card__hover-actions">
          {star}
          {more}
        </div>
      </div>
      <div className="fr-card__meta">
        <div className="fr-card__title" title={title}>
          {title}
        </div>
        <div className="fr-card__sub">
          <span className="fr-card__owner">{owner}</span>
          <span aria-hidden>·</span>
          <span>
            {time.label} {relativeTime(time.at)}
          </span>
        </div>
      </div>
    </div>
  );
});
