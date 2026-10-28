import { memo, useMemo } from 'react';
import type { BoardElement, StickyElement, Tag } from '@freero/shared';
import { defineDecoration, useCollection } from '@engine';
import { chipScale } from './lib/chips';
import './tags.css';

/** Below this zoom chips are unreadable specks: don't render any. */
const MIN_ZOOM = 0.3;
const MAX_CHIPS = 3;

/**
 * Chips along the bottom edge of a sticky, drawn inside the sticky's own wrapper: they move,
 * rotate, cull and export with it. (Cards draw their own chips in their footer.)
 */
const StickyChips = memo(function StickyChips({ element, zoom }: { element: BoardElement; zoom: number }) {
  const entries = useCollection<Tag>('tags');
  const tags = useMemo(() => new Map(entries), [entries]);
  const el = element as StickyElement;
  const known = (el.tags ?? []).map((t) => tags.get(t)).filter((t): t is Tag => !!t);
  if (zoom < MIN_ZOOM || !known.length) return null;
  return (
    <div className="fr-tagchips" style={{ ['--s' as string]: chipScale(el.w, el.h) }}>
      <div className="fr-tagchips__row">
        {known.slice(0, MAX_CHIPS).map((t) => (
          <span key={t.id} className="fr-tagchips__chip" style={{ ['--tag' as string]: t.color }}>
            {t.name}
          </span>
        ))}
        {known.length > MAX_CHIPS && <span className="fr-tagchips__chip is-more">+{known.length - MAX_CHIPS}</span>}
      </div>
    </div>
  );
});

export default defineDecoration({
  id: 'tags.stickyChips',
  appliesTo: (el) => el.type === 'sticky' && !!el.tags?.length,
  Component: StickyChips,
  // The chip row's band (8 px margin + 18 px chip + 4 px gap, scaled like the chips): the
  // sticky's text stays above it.
  reserve: (el) => ({ bottom: 30 * chipScale(el.w, el.h) }),
});
