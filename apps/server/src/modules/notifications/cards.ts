// Task-card notifications (KAI-135), from realtime's card events (who assigned what, from a
// trusted socket, request or reveal — never a client's claim):
//   card.assigned     the card was assigned to you (not by you);
//   card.due_changed  someone else set or changed the due date of a card assigned to you;
//   card.due_soon     a card assigned to you is due tomorrow (one reminder per due date).
// Changes to one card are settled for CARD_SETTLE_MS before anyone is notified, so clicking
// through the assignee picker (Ann, Bob, Ann) notifies Ann once — or nobody, if it ends where it
// started. Reminders come from card_due_watch (kept from the same events), each re-checked
// against the card as the assignee sees it on the board right before it is sent.
import { isAnonymousAuthor, isGuestId, richTextToPlain } from '@freero/shared';
import { logError } from '../../platform/log';
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

const DAY_MS = 86_400_000;
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const REMINDER_BATCH = 200;

/**
 * Reminds assignees of cards due tomorrow (UTC calendar days; also today, for a reminder a
 * stopped server missed). Each candidate is re-read on the board as its assignee sees it: a card
 * gone, reassigned, re-dated or hidden from them is dropped instead. Idempotent; one reminder
 * per card and due date (the dedupe key holds even if marking it failed).
 */
export async function sendDueReminders(now = Date.now()): Promise<number> {
  let sent = 0;
  const due = await repo.cardsDueBetween(day(now), day(now + DAY_MS), REMINDER_BATCH);
  const byBoard = new Map<string, repo.CardDueWatch[]>();
  for (const w of due) byBoard.set(w.boardId, [...(byBoard.get(w.boardId) ?? []), w]);
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
