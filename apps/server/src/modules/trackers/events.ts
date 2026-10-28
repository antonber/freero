// What tracker sync did on a board, for the activity feed (modules/activity listens). Fired after
// the change committed; best effort like the other activity sources.
import type { TrackerProviderKind } from '@freero/shared';
import { logError } from '../../platform/log';

export interface TrackerActivityEvent {
  boardId: string;
  /** Who it is attributed to: the person who sent / imported / linked it. */
  actorId: string;
  action: 'tracker_sent' | 'tracker_imported' | 'tracker_synced' | 'tracker_failed' | 'tracker_unlinked';
  provider: TrackerProviderKind;
  /** The issue key ("PROJ-12"), or the number of issues for an import. */
  issue: string | null;
  /** Items sent (by type), or issues imported. */
  items?: Record<string, number>;
  count?: number;
  /** Fields written to the tracker. */
  fields?: string[];
  /** Why a sync failed (Freero's own words). */
  reason?: string;
}

const listeners = new Set<(e: TrackerActivityEvent) => void>();

export function onTrackerActivity(fn: (e: TrackerActivityEvent) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function emitTrackerActivity(e: TrackerActivityEvent): void {
  for (const fn of listeners) {
    try {
      fn(e);
    } catch (err) {
      logError('trackers: an activity listener failed', err);
    }
  }
}
