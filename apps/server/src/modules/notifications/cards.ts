// Task-card notifications (KAI-135), from realtime's card events (who assigned what, from a
// trusted socket, request or reveal — never a client's claim):
//   card.assigned     the card was assigned to you (not by you);
//   card.due_changed  someone else set or changed the due date of a card assigned to you;
//   card.due_soon     a card assigned to you is due tomorrow (one reminder per due date).
// Changes to one card are settled for CARD_SETTLE_MS before anyone is notified, so clicking
// through the assignee picker (Ann, Bob, Ann) notifies Ann once — or nobody, if it ends where it
// started. Reminders come from card_due_watch (kept from the same events), the day before in the
// assignee's time zone, each re-checked against the card as the assignee sees it on the board
// right before it is sent.
import { isAnonymousAuthor, isGuestId, richTextToPlain } from '@freero/shared';
import { logError } from '../../platform/log';
import { addDays, localDate } from '../../platform/time';
import { timeZonesOf } from '../auth/index';
import { getBoardAccess, getBoardTitle } from '../boards/index';
import { readBoardView, type CardAssignmentEvent } from '../realtime/index';
import * as repo from './repo';
import { notify } from './service';

/** How long a card's changes settle before they notify. */
export const CARD_SETTLE_MS = 4000;

interface Pending {
  first: CardAssignmentEvent;
  last: CardAssignmentEvent;
  timer: NodeJS.Timeout;
}
const pending = new Map<string, Pending>();
const running = new Set<Promise<void>>();

/** Realtime reports a card change (synchronously, while applying it): settle, then notify. */
export function onCardAssignment(e: CardAssignmentEvent, settled: () => void = () => undefined): void {
  const key = `${e.boardId}\n${e.elementId}`;
  const p = pending.get(key);
  if (p) {
    p.last = e;
    return;
  }
  const timer = setTimeout(() => flush(key, settled), CARD_SETTLE_MS);
  timer.unref();
  pending.set(key, { first: e, last: e, timer });
}

function flush(key: string, settled: () => void): void {
  const p = pending.get(key);
  if (!p) return;
  pending.delete(key);
  clearTimeout(p.timer);
  const work = settle(p.first, p.last)
    .catch((err) => logError('notifications: card notification failed', err))
    .finally(() => {
      running.delete(work);
      settled();
    });
  running.add(work);
}

/** Settles every pending card now (shutdown) and waits for them. */
export async function flushCardNotifications(): Promise<void> {
  for (const key of [...pending.keys()]) flush(key, () => undefined);
  await Promise.all([...running]);
}

/** The net change of one card over a settle window: `first` holds where it started, `last` where it ended. */
async function settle(first: CardAssignmentEvent, last: CardAssignmentEvent): Promise<void> {
  const { boardId, elementId } = last;
  await repo.setCardDueWatch(boardId, elementId, { assigneeId: last.assigneeId, dueDate: last.dueDate, title: last.title });
  const assignee = last.assigneeId;
  if (!assignee || last.removed || isGuestId(assignee)) return;
  const newAssignee = assignee !== first.previousAssigneeId;
  const dueChanged = last.dueDate !== first.previousDueDate;
  if (!newAssignee && !dueChanged) return;
  // A guest can't edit cards (commenter at most); an app acting for someone is that someone; a card
  // revealed anonymously from private mode (#44) is from nobody.
  const actorId = isGuestId(last.actorId) || !last.actorId || isAnonymousAuthor(last.actorId) ? null : last.actorId;
  const boardTitle = await getBoardTitle(boardId);
  if (boardTitle === null) return;
  const data = { boardTitle, elementId, cardTitle: last.title, dueDate: last.dueDate };
  await notify({ userId: assignee, type: newAssignee ? 'card.assigned' : 'card.due_changed', actorId, boardId, data });
}

const HOUR_MS = 3_600_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const REMINDER_BATCH = 200;
/** Most cards one run looks at (the next run continues). */
const REMINDER_MAX = 5000;

/**
 * Reminds assignees of cards due tomorrow — tomorrow where THEY are (their time zone; UTC while
 * it isn't known), and today, for a reminder a stopped server missed. A due date already past
 * there is not reminded of. Each candidate is re-read on the board as its assignee sees it: a card
 * gone, reassigned, re-dated or hidden from them is dropped instead. Idempotent; one reminder
 * per card and due date (the dedupe key holds even if marking it failed).
 */
export async function sendDueReminders(now = Date.now()): Promise<number> {
  let sent = 0;
  // Every time zone's today and tomorrow lie within these days (UTC-12 … UTC+14).
  const first = day(now - 12 * HOUR_MS);
  const last = addDays(day(now + 14 * HOUR_MS), 1);
  const due: repo.CardDueWatch[] = [];
  for (let after: repo.CardDueWatch | null = null; due.length < REMINDER_MAX; ) {
    const page = await repo.cardsDueBetween(first, last, REMINDER_BATCH, after);
    due.push(...page);
    if (page.length < REMINDER_BATCH) break;
    after = page[page.length - 1];
  }
  const zones = await timeZonesOf([...new Set(due.map((w) => w.assigneeId))]);
  const byBoard = new Map<string, repo.CardDueWatch[]>();
  for (const w of due) {
    const today = localDate(now, zones.get(w.assigneeId));
    if (w.dueDate < today) await repo.markCardReminded(w.boardId, w.elementId, w.dueDate); // past there: too late
    else if (w.dueDate <= addDays(today, 1)) byBoard.set(w.boardId, [...(byBoard.get(w.boardId) ?? []), w]);
    // else: not tomorrow there yet
  }
  for (const [boardId, watches] of byBoard) {
    const title = await getBoardTitle(boardId);
    for (const w of watches) {
      const { role } = await getBoardAccess(boardId, w.assigneeId);
      const card =
        title !== null && role
          ? (await readBoardView(boardId, { userId: w.assigneeId, role })).elements.find((e) => e.el.id === w.elementId && e.el.type === 'card')?.el
          : undefined;
      const still = card && card.type === 'card' && card.assigneeId === w.assigneeId && (card.dueDate ?? '').slice(0, 10) === w.dueDate;
      if (still && title !== null) {
        const created = await notify({
          userId: w.assigneeId,
          type: 'card.due_soon',
          actorId: null,
          boardId,
          data: { boardTitle: title, elementId: w.elementId, cardTitle: richTextToPlain(card.title ?? '').trim().slice(0, 200) || w.title, dueDate: w.dueDate },
          dedupeKey: `due:${boardId}:${w.elementId}:${w.dueDate}`,
        });
        if (created) sent++;
      }
      await repo.markCardReminded(boardId, w.elementId, w.dueDate);
    }
  }
  return sent;
}
