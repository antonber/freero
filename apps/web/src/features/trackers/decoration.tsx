import { memo } from 'react';
import { CircleAlert, Unplug } from 'lucide-react';
import { TRACKER_COLLECTION, type BoardElement, type TrackerIssueRecord } from '@freero/shared';
import { defineDecoration, useCollection, useIsExporting } from '@engine';
import { openIssue, recordOf } from './lib/links';
import './trackers.css';

/** Below this zoom the badge is an unreadable speck. */
const MIN_ZOOM = 0.3;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

/**
 * The issue badge on a linked item (top-right, inside its box): the issue key, its status in the
 * tracker and who it is assigned to, live from the `trackers` collection the server keeps up to
 * date — never copied into the item's text. Clicking it opens the issue.
 */
const IssueBadge = memo(function IssueBadge({ element, zoom }: { element: BoardElement; zoom: number }) {
  const entries = useCollection<TrackerIssueRecord>(TRACKER_COLLECTION);
  const exporting = useIsExporting();
  const hit = recordOf(new Map(entries), element);
  if (!hit || zoom < MIN_ZOOM) return null;
  const r = hit.record;
  const off = r.state === 'disconnected';
  const problem = r.state === 'error' || r.state === 'paused';
  const label = `${r.key}${r.status ? ` · ${r.status}` : ''}${r.assignee ? ` · ${r.assignee}` : ''}${problem && r.note ? ` — ${r.note}` : ''}`;
  return (
    <div className={`fr-trackers-badge-wrap${element.type === 'card' ? ' is-tab' : ''}`}>
      <button
        type="button"
        className={`fr-trackers-badge${off ? ' is-off' : ''}${problem ? ' is-problem' : ''}`}
        data-fr-interactive
        data-category={r.statusCategory ?? 'none'}
        title={exporting ? undefined : label}
        aria-label={`Issue ${label}. Open in ${r.connection}`}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          openIssue(r.url);
        }}
      >
        {off ? <Unplug size={11} aria-hidden /> : problem ? <CircleAlert size={11} aria-hidden /> : <span className="fr-trackers-badge__dot" aria-hidden />}
        <span className="fr-trackers-badge__key">{r.key}</span>
        {r.status && <span className="fr-trackers-badge__status">{r.status}</span>}
        {r.assignee && (
          <span className="fr-trackers-badge__who" aria-hidden>
            {initials(r.assignee)}
          </span>
        )}
      </button>
    </div>
  );
});

export default defineDecoration({
  id: 'trackers.issueBadge',
  order: 20,
  appliesTo: (el) => !!el.trackerLink,
  Component: IssueBadge,
  // The badge's band along the top edge: the item's text starts below it. A card's title starts
  // at its top, so on cards the badge sits on the top edge like a tab instead.
  reserve: (el) => (el.type === 'card' ? {} : { top: 26 }),
});
