// Loading the board's activity through the Host (paged, refreshed while the panel is open), and
// how entries read.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ActivityEntry } from '@freero/shared';
import type { Editor } from '@engine';
import { formatDate } from '@ui';

import { t } from '../messages';
/** While the panel is open, new entries are fetched this often (a burst is stored after a pause). */
export const REFRESH_MS = 30_000;

export interface Feed {
  entries: ActivityEntry[] | null;
  hasMore: boolean;
  loading: boolean;
  error: string | null;
  refresh(): void;
  more(): void;
}

/** Newest first; a refresh replaces the first page and keeps older pages already loaded. */
export function mergeFirstPage(fresh: ActivityEntry[], current: ActivityEntry[] | null): ActivityEntry[] {
  if (!current?.length || !fresh.length) return fresh.length ? fresh : (current ?? []);
  const oldest = fresh[fresh.length - 1].at;
  const ids = new Set(fresh.map((e) => e.id));
  return [...fresh, ...current.filter((e) => e.at < oldest && !ids.has(e.id))];
}

export function useActivity(editor: Editor): Feed {
  const [entries, setEntries] = useState<ActivityEntry[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  /** Older pages were loaded: a refresh of the first page doesn't decide whether there are more. */
  const paged = useRef(false);
  const source = editor.host.activity;

  const refresh = useCallback(() => {
    if (!source) return;
    setLoading(true);
    source.list().then(
      (page) => {
        if (!live.current) return;
        setEntries((cur) => mergeFirstPage(page.entries, cur));
        if (!paged.current) setHasMore(page.hasMore);
        setError(null);
        setLoading(false);
      },
      (err: unknown) => {
        if (!live.current) return;
        setError(err instanceof Error && err.message ? err.message : t('activityCouldnTBeLoaded'));
        setLoading(false);
      },
    );
  }, [source]);

  const more = useCallback(() => {
    if (!source || !entries?.length || loading) return;
    setLoading(true);
    source.list(entries[entries.length - 1].at).then(
      (page) => {
        if (!live.current) return;
        const ids = new Set(entries.map((e) => e.id));
        paged.current = true;
        setEntries([...entries, ...page.entries.filter((e) => !ids.has(e.id))]);
        setHasMore(page.hasMore);
        setLoading(false);
      },
      () => live.current && setLoading(false),
    );
  }, [source, entries, loading]);

  useEffect(() => {
    live.current = true;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      live.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  return { entries, hasMore, loading, error, refresh, more };
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 hours ago", "yesterday", "Oct 3". */
export function ago(ts: number, now = Date.now()): string {
  const d = now - ts;
  if (d < 45_000) return t('ago.justNow');
  if (d < HOUR) return t('ago.minutes', { count: Math.max(1, Math.round(d / MIN)) });
  if (d < DAY) return t('ago.hours', { count: Math.floor(d / HOUR) });
  if (d < 2 * DAY) return t('ago.yesterday');
  if (d < 7 * DAY) return t('ago.days', { count: Math.floor(d / DAY) });
  return formatDate(ts, { month: 'short', day: 'numeric' });
}
