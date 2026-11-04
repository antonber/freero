// What a guest added (#97): its `guestName` (stamped by the server, never by a client) shown just
// under the item as "Guest · <name>". Drawn inside the item's wrapper, so it moves, culls and
// exports with it; versions and exports keep it long after the guest's session ended.
import { memo } from 'react';
import type { BoardElement } from '@freero/shared';
import { defineDecoration } from '@engine';
import { t } from './messages';
import './guests.css';

/** Below this zoom the label is an unreadable speck. */
const MIN_ZOOM = 0.25;

const GuestLabel = memo(function GuestLabel({ element, zoom }: { element: BoardElement; zoom: number }) {
  if (!element.guestName || zoom < MIN_ZOOM) return null;
  const s = Math.max(0.6, Math.min(2, Math.min(element.w, element.h) / 200));
  return (
    <div className="fr-guests-label" style={{ ['--s' as string]: s }} title={t('addedByAGuest', { name: element.guestName })}>
      {t('guestName', { name: element.guestName })}
    </div>
  );
});

export default defineDecoration({
  id: 'guests.label',
  appliesTo: (el) => typeof el.guestName === 'string' && el.guestName.length > 0,
  Component: GuestLabel,
});
