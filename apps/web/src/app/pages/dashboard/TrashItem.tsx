// A board in the Trash view: not openable (it is gone for everyone until restored), only
// Restore and Delete forever. Owners only — the server lists nobody else's trash.
import { memo } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import type { BoardSummary } from '@freero/shared';
import { Button, IconButton } from '@ui';
import { BoardThumb } from './BoardThumb';
import { relativeTime } from '../../lib/time';

export interface TrashActions {
  restore(b: BoardSummary): void;
  deleteForever(b: BoardSummary): void;
}

const DAY = 86_400_000;

/** How long until the purge deletes it for good: "12 days left" / "Less than a day left". */
function purgeLabel(purgeAt: number | undefined, now = Date.now()): string {
  if (purgeAt === undefined) return '';
  const days = Math.ceil((purgeAt - now) / DAY);
  return days <= 1 ? 'Less than a day left' : `${days} days left`;
}

export const TrashItem = memo(function TrashItem({
  board: b,
  layout,
  actions,
}: {
  board: BoardSummary;
  layout: 'grid' | 'list';
  actions: TrashActions;
}) {
  const title = b.title || 'Untitled board';
  const deleted = b.deletedAt ? `Deleted ${relativeTime(b.deletedAt)}` : 'Deleted';
  const restore = (
    <Button size="sm" icon={RotateCcw} onClick={() => actions.restore(b)}>
      Restore
    </Button>
  );
  const forever = (
    <IconButton size={32} icon={Trash2} label="Delete forever" tooltipSide="top" className="fr-dash-trash__forever" onClick={() => actions.deleteForever(b)} />
  );

  if (layout === 'list') {
    return (
      <div className="fr-row" role="listitem">
        <div className="fr-row__thumb fr-dash-trash__thumb">
          <BoardThumb board={b} />
        </div>
        <div className="fr-row__title" title={title}>
          {title}
        </div>
        <div className="fr-row__time">{b.deletedAt ? relativeTime(b.deletedAt) : ''}</div>
        <div className="fr-row__time">{purgeLabel(b.purgeAt)}</div>
        <div className="fr-row__actions fr-dash-trash__actions">
          {restore}
          {forever}
        </div>
      </div>
    );
  }

  return (
    <div className="fr-dash-card fr-dash-trash">
      <div className="fr-dash-card__thumb fr-dash-trash__thumb">
        <BoardThumb board={b} />
      </div>
      <div className="fr-dash-card__meta">
        <div className="fr-dash-card__title" title={title}>
          {title}
        </div>
        <div className="fr-dash-card__sub">
          <span>{deleted}</span>
        </div>
        <div className="fr-dash-trash__purge">{purgeLabel(b.purgeAt)}</div>
        <div className="fr-dash-trash__actions">
          {restore}
          {forever}
        </div>
      </div>
    </div>
  );
});
