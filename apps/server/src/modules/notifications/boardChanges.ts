// "Changes on your boards" (#46): an email, off unless chosen, summarising what OTHER people did on
// the boards someone owns or starred — each morning (daily) or on Monday morning (weekly), in their
// time zone. What changed comes from the activity feed by the catch-up's rules (activity's
// `boardChangesSince`: attributed changes only, hidden frames' contents for owners and editors,
// boards they can still open). It never names item content: counts, people and board titles.
// Its unsubscribe link (signed, no session) turns only this email off; the master switch of
// notification emails stops it too. Claim-then-send, like the notification digest.
import { log, logError } from '../../platform/log';
import { appUrl, renderMail, sendMail } from '../../platform/mail';
import { addDays, formatWhen, localDate, localWeekday } from '../../platform/time';
import { boardChangesSince, type BoardChanges } from '../activity/index';
import { getAccount, timeZonesOf } from '../auth/index';
import { boardsOwnedOrStarredBy } from '../boards/index';
import * as repo from './repo';
import { BOARD_CHANGES_LIST, unsubscribeToken } from './service';

/** The hour (local) a digest day starts: emails go out from then on. */
export const DIGEST_HOUR = 8;
const HOUR = 3_600_000;
/** People handled per run (the next run continues). */
const BATCH = 200;
const MAX_BOARDS = 25;

/**
 * Which digest an instant falls in (pure): daily — the local day, counted from DIGEST_HOUR;
 * weekly — the Monday that week starts on. A digest is due once `now` is in a later one than the
 * last email.
 */
export function digestPeriod(ms: number, frequency: repo.DigestFrequency, zone: string | null): string {
  const shifted = ms - DIGEST_HOUR * HOUR;
  const day = localDate(shifted, zone);
  if (frequency === 'daily') return day;
  return addDays(day, -((localWeekday(shifted, zone) + 6) % 7));
}

const STEP = 15 * 60_000;

/**
 * When the next email is due for a window that started at `from`: the first moment (to the
 * quarter hour, so half-hour time zones work) in a later digest period where the reader is.
 */
export function nextDigestAt(from: number, frequency: repo.DigestFrequency, zone: string | null): number {
  const period = digestPeriod(from, frequency, zone);
  let t = Math.floor(from / STEP) * STEP + STEP;
  for (let i = 0; i < (8 * 24 * HOUR) / STEP && digestPeriod(t, frequency, zone) <= period; i++) t += STEP;
  return t;
}

/** Turns the email on (window from now, or kept), changes its frequency, or turns it off. */
export async function setBoardChangesFrequency(userId: string, frequency: 'off' | repo.DigestFrequency, now = Date.now()): Promise<void> {
  if (frequency === 'off') return repo.setBoardChangeDigest(userId, null, now);
  const zone = (await timeZonesOf([userId])).get(userId) ?? null;
  await repo.setBoardChangeDigest(userId, frequency, now, (from) => nextDigestAt(from, frequency, zone));
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Ann, Bob and 2 others" */
function names(people: string[]): string {
  if (people.length <= 2) return people.join(' and ') || 'Someone';
  if (people.length === 3) return `${people[0]}, ${people[1]} and ${people[2]}`;
  return `${people[0]}, ${people[1]} and ${people.length - 2} others`;
}

/** "added 12 items, changed 3 and removed 1 · 4 new comments" */
export function changesPhrase(c: BoardChanges['counts']): string {
  const parts: string[] = [];
  if (c.added) parts.push(`added ${plural(c.added, 'item')}`);
  if (c.changed) parts.push(`changed ${parts.length ? c.changed : plural(c.changed, 'item')}`);
  if (c.removed) parts.push(`removed ${parts.length ? c.removed : plural(c.removed, 'item')}`);
  const edits = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
  const comments = c.comments ? plural(c.comments, 'new comment') : '';
  return [edits, comments].filter(Boolean).join(' · ') || 'made changes';
}

/** Sends every due "changes on your boards" email. Idempotent; a failed send is handed back. */
export async function sendBoardChangeDigests(now = Date.now()): Promise<number> {
  const due = await repo.dueBoardChangeDigests(now, BATCH);
  if (!due.length) return 0;
  const zones = await timeZonesOf(due.map((c) => c.userId));
  let sent = 0;
  for (const c of due) {
    const zone = zones.get(c.userId) ?? null;
    const next = { lastSentAt: now, nextAt: nextDigestAt(now, c.frequency, zone) };
    // Due by a time zone changed since: just move to the right morning.
    if (digestPeriod(now, c.frequency, zone) <= digestPeriod(c.lastSentAt, c.frequency, zone)) {
      await repo.moveBoardChangeDigest(c.userId, c, { lastSentAt: c.lastSentAt, nextAt: nextDigestAt(c.lastSentAt, c.frequency, zone) });
      continue;
    }
    if (!(await repo.moveBoardChangeDigest(c.userId, c, next))) continue; // another run has it
    if ((await repo.prefs(c.userId)).get('*') === false) continue; // every notification email is off
    try {
      const mail = await compose(c, zone, now);
      if (!mail) continue; // nothing changed: the window moves on quietly
      await sendMail(mail);
      sent++;
    } catch (e) {
      await repo.moveBoardChangeDigest(c.userId, next, c);
      logError('notifications: could not send a "changes on your boards" email; retrying next run', e);
    }
  }
  if (sent) log(`notifications: sent ${sent} "changes on your boards" email(s)`);
  return sent;
}

async function compose(c: repo.BoardChangeDigest, zone: string | null, now: number) {
  let account;
  try {
    account = await getAccount(c.userId);
  } catch {
    return null; // deleted meanwhile
  }
  if (!account.emailVerified || account.deletionScheduledFor) return null;
  const boards = await boardsOwnedOrStarredBy(c.userId);
  if (!boards.length) return null;
  const titles = new Map(boards.map((b) => [b.id, b.title]));
  const changes = await boardChangesSince(c.userId, boards, c.lastSentAt);
  if (!changes.length) return null;
  const total = (x: BoardChanges) => x.counts.added + x.counts.changed + x.counts.removed + x.counts.comments;
  changes.sort((a, b) => total(b) - total(a));
  const shown = changes.slice(0, MAX_BOARDS);
  const token = unsubscribeToken(c.userId, BOARD_CHANGES_LIST);
  const query = `token=${encodeURIComponent(token)}&list=${BOARD_CHANGES_LIST}`;
  const period = c.frequency === 'daily' ? 'since yesterday' : 'this past week';
  return {
    to: account.email,
    ...renderMail({
      subject: changes.length === 1 ? `Changes on “${titles.get(changes[0].boardId) || 'Untitled board'}”` : `Changes on ${changes.length} of your boards`,
      title: changes.length === 1 ? `What changed on your board ${period}` : `What changed on ${changes.length} of your boards ${period}`,
      paragraphs: [
        `Since ${formatWhen(c.lastSentAt, zone)}.${changes.length > shown.length ? ` The ${shown.length} busiest are listed; ${changes.length - shown.length} more changed too.` : ''}`,
      ],
      items: shown.map((x) => ({
        heading: `“${titles.get(x.boardId) || 'Untitled board'}”: ${names(x.people)} ${changesPhrase(x.counts)}`,
        link: { label: 'See what changed', url: appUrl(null, `/board/${encodeURIComponent(x.boardId)}?changes=1`) },
      })),
      action: { label: 'Open Freero', url: appUrl(null, '/app') },
      outro: `You get this ${c.frequency} summary for boards you own or starred, because you turned it on in your account settings.`,
      unsubscribe: {
        label: 'Stop these summaries',
        url: appUrl(null, `/unsubscribe?${query}`),
        oneClickUrl: appUrl(null, `/api/notifications/unsubscribe?${query}`),
      },
    }),
  };
}
