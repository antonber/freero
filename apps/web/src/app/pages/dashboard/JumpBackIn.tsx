// "Jump back in": the boards and docs this person opened most recently, above a long list, so
// coming back to Freero starts where they left off (the dashboard's own list is sorted by
// whatever they chose).
import { Link } from 'react-router-dom';
import { FileText, LayoutDashboard } from 'lucide-react';
import type { BoardSummary } from '@freero/shared';
import { objectHref } from '../../lib/boards';
import { t as tr } from './messages';

/** Shown only above this many boards: a shorter list already shows them at a glance. */
const ABOVE = 6;
const SHOWN = 3;

export function JumpBackIn({ boards }: { boards: BoardSummary[] | null }) {
  if (!boards || boards.length <= ABOVE) return null;
  const recent = boards
    .filter((b) => b.lastOpenedAt !== null && !b.archivedAt)
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, SHOWN);
  if (!recent.length) return null;
  return (
    <section className="fr-dash-jump" aria-labelledby="fr-dash-jump-title">
      <h2 id="fr-dash-jump-title" className="fr-dash-jump__title">{tr('jumpBackIn')}</h2>
      <div className="fr-dash-jump__list">
        {recent.map((b) => {
          const Icon = b.kind === 'doc' ? FileText : LayoutDashboard;
          return (
            <Link key={b.id} className="fr-dash-jump__item" to={objectHref(b)}>
              <Icon size={16} aria-hidden />
              <span className="fr-dash-jump__name">{b.title || tr('untitledBoard')}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
