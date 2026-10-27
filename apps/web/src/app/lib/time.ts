// Human-friendly relative timestamps for the dashboard ("5 min ago", "Yesterday", "Mar 4").

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
  if (diff < 45_000) return 'just now';
  if (diff < HOUR) {
    const m = Math.max(1, Math.round(diff / MIN));
    return m >= 60 ? '1 hour ago' : `${m} min ago`;
  }
  const today = startOfDay(now);
  if (diff < DAY && ts >= today) {
    const h = Math.max(1, Math.floor(diff / HOUR));
    return h === 1 ? '1 hour ago' : `${h} hours ago`;
  }
  const dayDiff = Math.round((today - startOfDay(ts)) / DAY);
  if (dayDiff <= 1) return 'Yesterday';
  if (dayDiff < 7) return `${dayDiff} days ago`;
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
