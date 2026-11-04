// Human-friendly relative timestamps for the dashboard ("5 min ago", "Yesterday", "Mar 4"), in
// the interface's language (docs/design/i18n.md).
import { formatDate } from '@ui';
import { t } from '../messages';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = now - ts;
  if (diff < 45_000) return t('time.justNow');
  if (diff < HOUR) {
    const m = Math.max(1, Math.round(diff / MIN));
    return m >= 60 ? t('time.hoursAgo', { count: 1 }) : t('time.minutesAgo', { count: m });
  }
  const today = startOfDay(now);
  if (diff < DAY && ts >= today) return t('time.hoursAgo', { count: Math.max(1, Math.floor(diff / HOUR)) });
  const dayDiff = Math.round((today - startOfDay(ts)) / DAY);
  if (dayDiff <= 1) return t('time.yesterday');
  if (dayDiff < 7) return t('time.daysAgo', { count: dayDiff });
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return formatDate(d, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
