// A board as an agent's control room (KAI-172; docs/mcp.md "Agent control room"). A long-running
// agent keeps a LANE on a board — a "Plan · <agent>" note, a "Status · <agent>" note and a
// "Tasks · <agent>" kanban with To do / Doing / Done / Blocked — and posts to it with
// `postStatus`; people steer it by moving cards and commenting, and the agent reads that back with
// `getFeedback`. Plain board content: the lane is ordinary notes, a kanban and cards anyone with
// access can move, and the "Agent control room" template (web features/templates) builds one for a
// placeholder agent that the first post claims.
//
// Tasks are identified by their title within the lane (a retry with the same title updates the card
// instead of adding another); a status moves the card to its column like dropping it there would.
//
// Feedback is a diff of the lane against the CURSOR the agent holds (opaque, returned by both
// calls): where each card was, which comment messages it saw. So what the agent did itself is never
// reported back, nothing depends on clocks, and nothing is stored on the server for it. Push instead
// of poll: a team workspace's webhooks deliver the same changes (item.updated, comment.created) as
// they happen (docs/events.md).
import {
  KANBAN_LAYOUT,
  layoutStructure,
  placeLaidOut,
  plainToRichText,
  richTextToPlain,
  type BoardElement,
  type CardStatus,
  type ElementDraft,
  type KanbanElement,
  type LaidOut,
} from '@freero/shared';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { requireBoardAccess } from '../boards/index';
import { changeBoard, COMMENTS_COLLECTION, readBoardView, type BoardView } from '../realtime/index';
import { newElementId } from '../structure/index';
import { actorOf, agentWrite, boardUrl, change, createBoard, openBoard, present, type ApiCall } from './service';

export type TaskState = 'todo' | 'doing' | 'done' | 'blocked';
const COLUMNS: Array<{ title: string; status: CardStatus | null; key: TaskState }> = [
  { title: 'To do', status: 'todo', key: 'todo' },
  { title: 'Doing', status: 'doing', key: 'doing' },
  { title: 'Done', status: 'done', key: 'done' },
  { title: 'Blocked', status: null, key: 'blocked' },
];
const BLOCKED_ACCENT = '#E5484D';
const TASK_ACCENT = '#5B3FF0';
/** The template's lane, claimed by the first agent that posts to its board. */
export const PLACEHOLDER_AGENT = 'Agent';
const MAX_TASKS = 100;
const MAX_TEXT = 2000;

export interface StatusPost {
  boardId?: string;
  /** A new control-room board's title (without boardId). */
  title?: string;
  workspaceId?: string;
  /** The lane's name (default: the app or token's name). */
  agent?: string;
  /** The cursor of the previous post or feedback: changes people made since stay reportable. */
  cursor?: string;
  status?: string;
  plan?: string[];
  tasks?: Array<{ title: string; state: TaskState; note?: string }>;
}

interface Cursor {
  v: 1;
  board: string;
  agent: string;
  /** Card id -> the column index the agent last saw it in. */
  cards: Record<string, number>;
  /** Comment message ids already seen (lane items' threads and the board's own). */
  seen: string[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
const plain = (v: unknown) => (typeof v === 'string' ? richTextToPlain(v) : '').trim();
const firstLine = (v: unknown) => plain(v).split('\n')[0]?.trim() ?? '';

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}
function decodeCursor(s: string | undefined, boardId: string): Cursor | null {
  if (!s) return null;
  try {
    const c = JSON.parse(Buffer.from(s, 'base64url').toString('utf8')) as Cursor;
    if (c?.v !== 1 || c.board !== boardId || typeof c.cards !== 'object' || !Array.isArray(c.seen)) throw new Error('shape');
    return c;
  } catch {
    throw badRequest('cursor is not one this board gave out (pass the cursor of your last post_status or get_feedback on the same board)');
  }
}

// ---- reading a lane ----

interface Lane {
  kanban: KanbanElement;
  plan: BoardElement | null;
  status: BoardElement | null;
  cards: BoardElement[];
}

const laneTitle = (what: 'Tasks' | 'Plan' | 'Status', agent: string) => `${what} · ${agent}`;

function findLane(view: BoardView, agent: string): Lane | null {
  const els = view.elements.map((e) => e.el);
  const kanban = els.find((e) => e.type === 'kanban' && norm(firstLine((e as KanbanElement).title)) === norm(laneTitle('Tasks', agent))) as KanbanElement | undefined;
  if (!kanban) return null;
  const note = (what: 'Plan' | 'Status') => els.find((e) => e.type === 'shape' && norm(firstLine((e as { text?: unknown }).text)) === norm(laneTitle(what, agent))) ?? null;
  return { kanban, plan: note('Plan'), status: note('Status'), cards: els.filter((e) => e.type === 'card' && e.frameId === kanban.id) };
}

/** The column a card's center is over (the kanban's own rule). */
function columnOf(k: KanbanElement, el: BoardElement): number {
  const { gap } = KANBAN_LAYOUT;
  const i = Math.floor((el.x + el.w / 2 - k.x - gap / 2) / (k.colW + gap));
  return Math.max(0, Math.min(k.columns.length - 1, i));
}
const columnTitle = (k: KanbanElement, i: number) => plain(k.columns[i]?.title) || `column ${i + 1}`;

function columnFor(k: KanbanElement, state: TaskState): number {
  const want = COLUMNS.find((c) => c.key === state)!;
  const byStatus = want.status ? k.columns.findIndex((c) => c.status === want.status) : -1;
  if (byStatus >= 0) return byStatus;
  return k.columns.findIndex((c) => norm(plain(c.title)) === norm(want.title));
}

// ---- writing ----

const noteText = (head: string, body: string) => `<b>${plainToRichText(head)}</b><br><br>${plainToRichText(body)}`;
/** A note's draft (the layout kit's), for its size. */
const noteDraft = (head: string, body: string) => layoutStructure({ kind: 'note', title: head, text: body }, { newId: newElementId }).elements[0];

function cardDraft(title: string, note: string, state: TaskState, w: number): ElementDraft {
  const laid = layoutStructure({ kind: 'items', layout: 'grid', items: [{ type: 'card', text: title, ...(note ? { description: note } : {}) }] }, { newId: newElementId });
  const c = laid.elements[0] as ElementDraft & { h: number };
  const col = COLUMNS.find((x) => x.key === state)!;
  return { ...c, w, status: col.status, color: state === 'blocked' ? BLOCKED_ACCENT : TASK_ACCENT } as ElementDraft;
}

const planBody = (plan: string[] | undefined) => (plan?.length ? plan.map((p, i) => `${i + 1}. ${p.trim()}`).join('\n') : 'No plan posted yet.');
const statusBody = (status: string | undefined) => (status?.trim() ? `${status.trim()}\n\n(${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)` : 'No status posted yet.');

/** A new lane laid out from (0, 0): the notes on the left, the kanban on the right. */
function newLane(agent: string, post: StatusPost): LaidOut & { kanbanId: string } {
  const plan = noteDraft(laneTitle('Plan', agent), planBody(post.plan));
  const status = noteDraft(laneTitle('Status', agent), statusBody(post.status));
  const kanban = layoutStructure({ kind: 'kanban', title: laneTitle('Tasks', agent), columns: COLUMNS.map((c) => ({ title: c.title, items: [] })) }, { newId: newElementId }).elements[0] as ElementDraft & KanbanElement;
  // Columns without a status (Blocked) keep a card's status as it is; give it its own accent.
  kanban.columns = kanban.columns.map((c, i) => (COLUMNS[i]?.key === 'blocked' ? { ...c, status: null, color: BLOCKED_ACCENT } : c));
  const gap = 48;
  const elements: ElementDraft[] = [
    { ...plan, x: 0, y: 0 },
    { ...status, x: 0, y: plan.h + gap },
    { ...kanban, x: plan.w + gap, y: 0 },
  ];
  return { elements, content: {}, moves: [], size: { w: plan.w + gap + kanban.w, h: Math.max(plan.h + gap + status.h, kanban.h) }, kanbanId: kanban.id };
}

/** Where a card goes at the bottom of column `col`, among `cards` (which the kanban grows to hold). */
function slot(k: KanbanElement, col: number, cards: BoardElement[], skip: string): { x: number; y: number } {
  const { gap, pad, itemGap, headerH, colHeadH } = KANBAN_LAYOUT;
  const left = k.x + gap + col * (k.colW + gap);
  const bottom = cards.filter((c) => c.id !== skip && columnOf(k, c) === col).reduce((m, c) => Math.max(m, c.y + c.h), k.y + headerH + colHeadH + pad - itemGap);
  return { x: left + pad, y: bottom + itemGap };
}

/** Posts the agent's plan, status and tasks to its lane (made on first post; a new board without boardId). */
export async function postStatus(call: ApiCall, post: StatusPost) {
  const agent = (post.agent?.trim() || call.cred.label).slice(0, 80);
  if ((post.tasks?.length ?? 0) > MAX_TASKS) throw badRequest(`At most ${MAX_TASKS} tasks per post (nothing was changed)`);
  for (const t of post.tasks ?? []) if (!t.title?.trim() || t.title.length > MAX_TEXT || (t.note?.length ?? 0) > MAX_TEXT) throw badRequest('Every task needs a title (at most 2000 characters, notes too); nothing was changed');
  let boardId = post.boardId;
  let createdBoard = false;
  if (!boardId) {
    const { board } = await createBoard(call, { title: post.title?.trim() || `${agent} control room`, workspaceId: post.workspaceId });
    boardId = board.id;
    createdBoard = true;
  }
  const { id, role } = await openBoard(call, boardId);
  await requireBoardAccess(id, call.userId, 'editor');
  await agentWrite(call);
  const prior = decodeCursor(post.cursor, id);
  const touched = new Map<string, number>();
  let laneIds: string[] = [];
  const titleKeys = new Map<string, string>();

  await change(() =>
    changeBoard(id, actorOf(call, role), (view) => {
      const create: ElementDraft[] = [];
      const update: Array<{ id: string; patch: Record<string, unknown> }> = [];
      let lane = findLane(view, agent);
      // The template's placeholder lane becomes this agent's on its first post.
      if (!lane && norm(agent) !== norm(PLACEHOLDER_AGENT)) {
        const spare = findLane(view, PLACEHOLDER_AGENT);
        if (spare) {
          lane = spare;
          update.push({ id: spare.kanban.id, patch: { title: plainToRichText(laneTitle('Tasks', agent)) } });
          if (spare.plan) update.push({ id: spare.plan.id, patch: { text: noteText(laneTitle('Plan', agent), planBody(post.plan ?? splitNote(spare.plan))) } });
          if (spare.status) update.push({ id: spare.status.id, patch: { text: noteText(laneTitle('Status', agent), statusBody(post.status ?? splitNote(spare.status).join('\n'))) } });
        }
      }
      let kanban: KanbanElement;
      let cards: BoardElement[];
      if (!lane) {
        const laid = newLane(agent, post);
        const placed = placeLaidOut(laid, { obstacles: view.elements.map((e) => e.el) });
        create.push(...placed.elements);
        kanban = placed.elements.find((e) => e.id === laid.kanbanId) as unknown as KanbanElement;
        cards = [];
        laneIds = placed.elements.map((e) => e.id);
      } else {
        kanban = lane.kanban;
        cards = [...lane.cards];
        laneIds = [lane.kanban.id, ...(lane.plan ? [lane.plan.id] : []), ...(lane.status ? [lane.status.id] : [])];
        const head = (what: 'Plan' | 'Status') => laneTitle(what, agent);
        if (post.plan && lane.plan) update.push({ id: lane.plan.id, patch: { text: noteText(head('Plan'), planBody(post.plan)), h: noteDraft(head('Plan'), planBody(post.plan)).h } });
        if (post.status !== undefined && lane.status)
          update.push({ id: lane.status.id, patch: { text: noteText(head('Status'), statusBody(post.status)), h: noteDraft(head('Status'), statusBody(post.status)).h } });
      }
      const inner = kanban.colW - 2 * KANBAN_LAYOUT.pad;
      let bottom = kanban.y + kanban.h;
      for (const t of post.tasks ?? []) {
        const col = columnFor(kanban, t.state);
        const key = norm(t.title);
        const existing = cards.find((c) => norm(plain((c as { title?: unknown }).title)) === key);
        const accent = t.state === 'blocked' ? BLOCKED_ACCENT : TASK_ACCENT;
        if (existing) {
          const patch: Record<string, unknown> = {};
          if (t.note !== undefined) patch.description = t.note ? plainToRichText(t.note.slice(0, MAX_TEXT)) : '';
          if (col >= 0 && columnOf(kanban, existing) !== col) {
            const at = slot(kanban, col, cards, existing.id);
            Object.assign(patch, at, { color: accent });
            const st = COLUMNS.find((c) => c.key === t.state)!.status;
            if (st) patch.status = st;
            Object.assign(existing, at);
          }
          if (Object.keys(patch).length) update.push({ id: existing.id, patch });
          touched.set(existing.id, col >= 0 ? col : columnOf(kanban, existing));
          titleKeys.set(key, existing.id);
          bottom = Math.max(bottom, existing.y + existing.h + KANBAN_LAYOUT.pad);
          continue;
        }
        if (titleKeys.has(key)) continue; // the same title twice in one post
        const at = slot(kanban, Math.max(0, col), cards, '');
        const draft = { ...cardDraft(t.title.trim(), t.note?.trim() ?? '', t.state, inner), ...at, frameId: kanban.id } as ElementDraft;
        create.push(draft);
        cards.push(draft as unknown as BoardElement);
        touched.set(draft.id, Math.max(0, col));
        titleKeys.set(key, draft.id);
        bottom = Math.max(bottom, at.y + (draft as { h: number }).h + KANBAN_LAYOUT.pad);
      }
      // The kanban grows to hold its cards.
      const needH = Math.ceil(bottom - kanban.y);
      if (needH > kanban.h) {
        const k = create.find((e) => e.id === kanban.id);
        if (k) (k as { h: number }).h = needH;
        else update.push({ id: kanban.id, patch: { h: needH } });
      }
      return { change: { create, update } };
    }),
  );

  const view = await readBoardView(id, { userId: call.userId, role });
  const lane = findLane(view, agent);
  if (!lane) throw new HttpError(500, 'The control room lane did not land on the board');
  present(call, id, [...touched.keys()].length ? [...touched.keys()] : laneIds, view);
  // The agent's own changes become the new baseline; what people did since `prior` stays to report.
  const cards: Record<string, number> = {};
  for (const c of lane.cards) {
    if (touched.has(c.id)) cards[c.id] = columnOf(lane.kanban, c);
    else if (prior && c.id in prior.cards) cards[c.id] = prior.cards[c.id];
    else if (!prior) cards[c.id] = columnOf(lane.kanban, c);
  }
  const seen = prior ? prior.seen : messagesOn(view, lane).map((m) => m.id);
  call.audit.metadata = { tasks: post.tasks?.length ?? 0, createdBoard };
  return {
    boardId: id,
    url: boardUrl(call.req, id),
    createdBoard,
    agent,
    tasks: lane.cards.map((c) => ({ id: c.id, title: plain((c as { title?: unknown }).title), column: columnTitle(lane.kanban, columnOf(lane.kanban, c)) })),
    cursor: encodeCursor({ v: 1, board: id, agent, cards, seen }),
  };
}

/** A note's text below its heading, as lines (the template's sample content). */
function splitNote(el: BoardElement): string[] {
  return plain((el as { text?: unknown }).text)
    .split('\n')
    .slice(1)
    .map((l) => l.replace(/^\d+\.\s*/, '').trim())
    .filter(Boolean);
}

interface LaneMessage {
  id: string;
  threadId: string;
  itemId: string | null;
  authorName: string;
  text: string;
  createdAt: number;
}

/** Comment messages on the lane's items and on the board itself (not on other agents' lanes). */
function messagesOn(view: BoardView, lane: Lane): LaneMessage[] {
  const comments = view.collection(COMMENTS_COLLECTION);
  const laneItems = new Set([lane.kanban.id, ...lane.cards.map((c) => c.id), ...(lane.plan ? [lane.plan.id] : []), ...(lane.status ? [lane.status.id] : [])]);
  const threads = new Map<string, string | null>();
  const deleted = new Set<string>();
  for (const [key, v] of comments) {
    const r = v as { kind?: string; id?: string; elementId?: string | null; threadId?: string; messageId?: string };
    if (r?.kind === 'thread' && typeof r.id === 'string') threads.set(r.id, r.elementId ?? null);
    if (r?.kind === 'deleted') deleted.add(key.slice(2));
  }
  const out: LaneMessage[] = [];
  for (const v of comments.values()) {
    const m = v as { kind?: string; id?: string; threadId?: string; authorName?: string; text?: string; createdAt?: number };
    if (m?.kind !== 'message' || typeof m.id !== 'string' || typeof m.threadId !== 'string' || deleted.has(m.threadId) || deleted.has(`${m.threadId}:${m.id}`)) continue;
    if (!threads.has(m.threadId)) continue;
    const itemId = threads.get(m.threadId) ?? null;
    if (itemId !== null && !laneItems.has(itemId)) continue;
    out.push({ id: `${m.threadId}:${m.id}`, threadId: m.threadId, itemId, authorName: String(m.authorName ?? ''), text: String(m.text ?? '').slice(0, MAX_TEXT), createdAt: Number(m.createdAt) || 0 });
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export type FeedbackChange =
  | { kind: 'card_moved'; itemId: string; title: string; from: string; to: string }
  | { kind: 'card_added'; itemId: string; title: string; column: string }
  | { kind: 'card_removed'; itemId: string }
  | { kind: 'comment'; threadId: string; itemId: string | null; itemTitle: string | null; author: string; text: string };

/** What people changed in the agent's lane since `cursor` (board text: untrusted), and the next cursor. */
export async function getFeedback(call: ApiCall, boardId: string, cursorIn: string | undefined, agentIn?: string) {
  const { id, role } = await openBoard(call, boardId);
  const prior = decodeCursor(cursorIn, id);
  const agent = (agentIn?.trim() || prior?.agent || call.cred.label).slice(0, 80);
  const view = await readBoardView(id, { userId: call.userId, role });
  const lane = findLane(view, agent);
  if (!lane) throw notFound(`No control room lane for ${agent} on this board. Post to it with post_status first.`);
  const k = lane.kanban;
  const titleOf = (c: BoardElement) => plain((c as { title?: unknown }).title);
  const changes: FeedbackChange[] = [];
  const now: Record<string, number> = {};
  for (const c of lane.cards) {
    const col = columnOf(k, c);
    now[c.id] = col;
    if (!prior) continue;
    if (!(c.id in prior.cards)) changes.push({ kind: 'card_added', itemId: c.id, title: titleOf(c), column: columnTitle(k, col) });
    else if (prior.cards[c.id] !== col) changes.push({ kind: 'card_moved', itemId: c.id, title: titleOf(c), from: columnTitle(k, prior.cards[c.id]), to: columnTitle(k, col) });
  }
  if (prior) for (const gone of Object.keys(prior.cards)) if (!(gone in now)) changes.push({ kind: 'card_removed', itemId: gone });
  const messages = messagesOn(view, lane);
  const seen = new Set(prior?.seen ?? []);
  const cardTitle = new Map(lane.cards.map((c) => [c.id, titleOf(c)]));
  if (prior)
    for (const m of messages)
      if (!seen.has(m.id)) changes.push({ kind: 'comment', threadId: m.threadId, itemId: m.itemId, itemTitle: m.itemId ? (cardTitle.get(m.itemId) ?? null) : null, author: m.authorName, text: m.text });
  return {
    boardId: id,
    agent,
    changes,
    // A first call (no cursor) only sets the baseline: from here on, what people do is reported.
    baseline: !prior,
    cursor: encodeCursor({ v: 1, board: id, agent, cards: now, seen: messages.map((m) => m.id) }),
  };
}
