// Ongoing use, for PostHog (POSTHOG_KEY; ARCHITECTURE.md "Product analytics"): what people — and
// the apps and assistants acting for them — do on boards and docs, counted from realtime's trusted
// change streams, the ones the activity feed and notifications follow: each change is reported
// once, by the instance that applied it, for the socket's user or the request's actor, never on a
// client's say-so.
//
//   items_added              items added to boards, per account, workspace, door and item type
//   comment_added            new comment messages, per account, workspace and door
//                            — both gathered for WINDOW_MS, then sent as one event per type
//   agent_proposal_resolved  proposals of an app or of Freero's AI accepted / rejected by someone
//   doc_edited               the first change of a doc's text per account, doc and UTC day
//
// Never a board or doc id, an item's content or a comment's text: only counts, types and the door
// (`via`: app, api, mcp, other). Nothing a socket or request whose browser asked not to be tracked
// did is counted; guests have no account and are never counted.
//
// In memory on each instance: a crash loses the window being gathered (never counts it twice),
// and doc_edited's "once a day" is per instance and process — with several instances, or after a
// restart, the same doc can be counted again the same day by the same person.
import { isGuestId, isProductItemType, type ProductEventVia, type ProductItemType } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { logError } from '../../platform/log';
import { boardWorkspaceId } from '../boards/index';
import {
  onBoardChange,
  onCommentMessage,
  onDocEdited,
  onSuggestionsDecided,
  type BoardChangeEvent,
  type ChangeDoor,
  type CommentMessageEvent,
  type DocEditedEvent,
  type SuggestionsDecidedEvent,
} from '../realtime/index';
import { trackProductEvent } from './productEvents';

/** How long items and comments are gathered before they are sent. */
export const WINDOW_MS = 5 * 60_000;
const DAY_MS = 86_400_000;

/** What one account did on one board through one door in the current window. */
interface Gathered {
  accountId: string;
  boardId: string;
  via: ProductEventVia;
  /** Items added to the shared board (id → type), less those removed again. */
  added: Map<string, ProductItemType>;
  /** Items removed from the shared board in this window: brought back (undo), they are no new item. */
  removed: Set<string>;
  /**
   * Items that left the hidden frames' layer: a frame shown again moves its contents into the
   * shared board, which is no new item either. (Hiding one moves them the other way, and the
   * shared board's side of that is not reported: items added to the hidden layer are not counted,
   * since they can't be told from a frame being hidden.)
   */
  leftHidden: Set<string>;
  comments: number;
}

const gathered = new Map<string, Gathered>();
/** Events waiting for their board's workspace (a flush waits for them). */
const looking = new Set<Promise<void>>();
const track = (p: Promise<void>): void => {
  looking.add(p);
  void p.finally(() => looking.delete(p));
};

/** Whether what came through `door` from `actorId` may be counted at all. */
const countable = (actorId: string, door: ChangeDoor | undefined): door is ChangeDoor => !!door && !door.privacySignal && !!actorId && !isGuestId(actorId);

function gatheredFor(accountId: string, boardId: string, via: ProductEventVia): Gathered {
  const key = `${accountId}\u0000${boardId}\u0000${via}`;
  let g = gathered.get(key);
  if (!g) gathered.set(key, (g = { accountId, boardId, via, added: new Map(), removed: new Set(), leftHidden: new Set(), comments: 0 }));
  return g;
}

export function noteBoardChange(e: BoardChangeEvent): void {
  if (!countable(e.actorId, e.door)) return;
  const g = gatheredFor(e.actorId, e.boardId, e.door.surface);
  for (const c of e.changes) {
    if (e.layer === 'editors') {
      if (c.op === 'remove') g.leftHidden.add(c.id);
    } else if (c.op === 'add') {
      if (!g.removed.delete(c.id) && isProductItemType(c.type)) g.added.set(c.id, c.type);
    } else if (c.op === 'remove' && !g.added.delete(c.id)) g.removed.add(c.id);
  }
}

export function noteComment(e: CommentMessageEvent): void {
  if (e.previousText !== null || e.layer === 'private' || !countable(e.authorId, e.door)) return;
  gatheredFor(e.authorId, e.boardId, e.door.surface).comments++;
}

/** Sends what was gathered, once the events waiting for a workspace are counted (every WINDOW_MS, at shutdown; tests). */
export async function flushUsage(): Promise<void> {
  await Promise.allSettled([...looking]);
  const done = [...gathered.values()];
  gathered.clear();
  const workspaces = new Map<string, string | null>();
  const merged = new Map<string, { accountId: string; workspaceId: string | null; via: ProductEventVia; types: Map<ProductItemType, number>; comments: number }>();
  for (const g of done) {
    if (!workspaces.has(g.boardId)) workspaces.set(g.boardId, await boardWorkspaceId(g.boardId).catch(() => null));
    const workspaceId = workspaces.get(g.boardId) ?? null;
    const key = `${g.accountId}\u0000${workspaceId ?? ''}\u0000${g.via}`;
    let m = merged.get(key);
    if (!m) merged.set(key, (m = { accountId: g.accountId, workspaceId, via: g.via, types: new Map(), comments: 0 }));
    for (const [id, type] of g.added) if (!g.leftHidden.has(id)) m.types.set(type, (m.types.get(type) ?? 0) + 1);
    m.comments += g.comments;
  }
  for (const m of merged.values()) {
    for (const [type, count] of m.types) trackProductEvent(m.accountId, { name: 'items_added', type, count, via: m.via }, { workspaceId: m.workspaceId });
    if (m.comments) trackProductEvent(m.accountId, { name: 'comment_added', count: m.comments, via: m.via }, { workspaceId: m.workspaceId });
  }
}

export async function noteDecisions(e: SuggestionsDecidedEvent): Promise<void> {
  if (!countable(e.actorId, e.door)) return;
  const counts = new Map<string, number>();
  for (const d of e.decisions)
    if (d.status !== 'reopened' && !d.withdrawn && (d.author === 'app' || d.author === 'ai')) counts.set(`${d.status}:${d.author}`, (counts.get(`${d.status}:${d.author}`) ?? 0) + 1);
  if (!counts.size) return;
  const workspaceId = await boardWorkspaceId(e.boardId);
  for (const [k, count] of counts) {
    const [outcome, proposer] = k.split(':') as ['accepted' | 'rejected', 'app' | 'ai'];
    trackProductEvent(e.actorId, { name: 'agent_proposal_resolved', outcome, proposer, count }, { workspaceId });
  }
}

/** Account and doc pairs counted today (doc_edited), and which UTC day that is. */
let editedToday = new Set<string>();
let editedDay = -1;

/** Every keystroke in a doc reports an edit: all but the day's first stop at the set, synchronously. */
export function noteDocEdited(e: DocEditedEvent, now = Date.now()): Promise<void> | null {
  if (!countable(e.actorId, e.door)) return null;
  const day = Math.floor(now / DAY_MS);
  if (day !== editedDay) [editedToday, editedDay] = [new Set(), day];
  const key = `${e.actorId}\u0000${e.docId}`;
  if (editedToday.has(key)) return null;
  editedToday.add(key);
  const via = e.door.surface;
  return boardWorkspaceId(e.docId).then((workspaceId) => trackProductEvent(e.actorId, { name: 'doc_edited', via }, { workspaceId }));
}

/**
 * Follows realtime's streams and sends a window's counts every WINDOW_MS. Its shutdown hook is
 * registered after the client's (init.ts), so it runs first: the last window is sent too.
 */
export function startUsageCounting(ctx: ServerContext): void {
  const failed = (what: string) => (err: unknown) => logError(`analytics: could not count ${what}`, err);
  const stops = [
    onBoardChange(noteBoardChange),
    onCommentMessage(noteComment),
    onSuggestionsDecided((e) => track(noteDecisions(e).catch(failed('decisions on proposals')))),
    onDocEdited((e) => {
      const counting = noteDocEdited(e);
      if (counting) track(counting.catch(failed('a doc edit')));
    }),
  ];
  const timer = setInterval(() => void flushUsage().catch(failed('items and comments')), WINDOW_MS);
  timer.unref();
  ctx.onShutdown(async () => {
    clearInterval(timer);
    stops.forEach((stop) => stop());
    await flushUsage().catch(failed('items and comments'));
  });
}
