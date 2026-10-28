// The activity feed. Sources are trusted server-side events only: element changes realtime applied
// from a person's own socket or on their request (realtime.onBoardChange — the same updates it
// appends to the board's update log; requests: the public API, MCP, insert structure, KAI-207),
// comment messages (realtime.onCommentMessage) and sharing (members' onBoardShared /
// onAccessDecided). What an app or token did for someone is its own burst, worded "<app> for
// <person>" (KAI-168). A person's changes on a board are gathered into one BURST until they pause
// (IDLE_MS) or it grows old (MAX_BURST_MS), then stored as one row per kind/audience with net
// counts ("added 12 sticky notes"): something added and removed again in the same burst is not
// news. Bursts live in memory on the instance whose socket made the changes, and are written on
// shutdown too.
//
// Access: rows about hidden frames' contents ('editors' layer) are shown to owners/editors only;
// private layers are never observed (realtime/changes.ts). No element text is stored, only types,
// counts and the title of the frame the changes were in (frames are visible to everyone).
import {
  actingFor,
  guestDisplayName,
  isGuestId,
  type ActingApp,
  type ActivityEntry,
  type ActivityResponse,
  type Role,
} from '@freero/shared';
import { getConfig } from '../../platform/config';
import { notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { getGuests, getUsers } from '../auth/index';
import { boardsOpenableIn, getBoardAccess } from '../boards/index';
import type { AccessDecidedEvent, BoardSharedEvent } from '../members/index';
import type { BoardChangeEvent, CommentMessageEvent } from '../realtime/index';
import * as repo from './repo';
import type { ActivityRow, ActivitySummary } from './repo';

/** A burst ends after ACTIVITY_IDLE_SECONDS without a change from that person on that board… */
const idleMs = () => getConfig().activityIdleMs;
/** …or once it has run this long. */
export const MAX_BURST_MS = 10 * 60_000;
export const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

interface Bucket {
  added: Map<string, string>;
  changed: Map<string, string>;
  removed: Map<string, string>;
  /** element id -> frame id it is in (null: none). */
  frameOf: Map<string, string | null>;
}
interface Burst {
  boardId: string;
  actorId: string;
  actorName: string;
  /** The app or token that acted for the actor (null: they did it themselves). */
  via: ActingApp | null;
  startedAt: number;
  lastAt: number;
  shared: Bucket;
  editors: Bucket;
  comments: number;
  threads: Set<string>;
  frameTitles: Map<string, string>;
}

const bucket = (): Bucket => ({ added: new Map(), changed: new Map(), removed: new Map(), frameOf: new Map() });
const bursts = new Map<string, Burst>();

function burstFor(boardId: string, actorId: string, actorName: string, via: ActingApp | null, now: number): Burst {
  const key = `${boardId}\u0000${actorId}\u0000${via ? `${via.kind}:${via.id}` : ''}`;
  let b = bursts.get(key);
  if (!b) {
    b = { boardId, actorId, actorName, via, startedAt: now, lastAt: now, shared: bucket(), editors: bucket(), comments: 0, threads: new Set(), frameTitles: new Map() };
    bursts.set(key, b);
  }
  b.lastAt = now;
  b.actorName = actorName;
  return b;
}

/** Element changes from a socket (realtime). Net per element over the burst. */
export function recordChanges(e: BoardChangeEvent, now = Date.now()): void {
  const b = burstFor(e.boardId, e.actorId, e.actorName, e.via ?? null, now);
  const k = e.layer === 'editors' ? b.editors : b.shared;
  for (const [id, title] of Object.entries(e.frameTitles)) b.frameTitles.set(id, title);
  for (const c of e.changes) {
    k.frameOf.set(c.id, c.frameId);
    if (c.op === 'add') {
      if (k.removed.delete(c.id)) k.changed.set(c.id, c.type); // removed and brought back (undo): a change
      else k.added.set(c.id, c.type);
    } else if (c.op === 'change') {
      if (!k.added.has(c.id)) k.changed.set(c.id, c.type);
    } else if (!k.added.delete(c.id)) {
      // Removing something added in this burst leaves nothing to say about it.
      k.changed.delete(c.id);
      k.removed.set(c.id, c.type);
    }
  }
}

/** A comment message written through a socket (realtime). Edits of a message are not news. */
export function recordComment(e: CommentMessageEvent, actorName: string, now = Date.now()): void {
  if (e.previousText !== null) return;
  const b = burstFor(e.boardId, e.authorId, actorName, e.via ?? null, now);
  b.comments++;
  b.threads.add(e.threadId);
}

const counts = (m: Map<string, string>): Record<string, number> | undefined => {
  if (m.size === 0) return undefined;
  const out: Record<string, number> = {};
  for (const type of m.values()) out[type] = (out[type] ?? 0) + 1;
  return out;
};

function editSummary(k: Bucket, titles: Map<string, string>): ActivitySummary | null {
  if (k.added.size + k.changed.size + k.removed.size === 0) return null;
  const frames = new Set<string | null>();
  for (const m of [k.added, k.changed, k.removed]) for (const id of m.keys()) frames.add(k.frameOf.get(id) ?? null);
  const only = frames.size === 1 ? [...frames][0] : null;
  const named = [...frames].filter((f): f is string => !!f);
  return {
    ...(counts(k.added) ? { added: counts(k.added) } : {}),
    ...(counts(k.changed) ? { changed: counts(k.changed) } : {}),
    ...(counts(k.removed) ? { removed: counts(k.removed) } : {}),
    ...(only && titles.get(only) !== undefined ? { frame: titles.get(only) } : {}),
    ...(named.length > 1 ? { frames: named.length } : {}),
  };
}

/** The rows a finished burst becomes (pure; exported for tests). */
export function rowsOf(b: Burst): ActivityRow[] {
  // Moving something into or out of a hidden frame moves it between the shared doc and the
  // editors layer: a removal on one side and an addition on the other, which is not news.
  for (const id of [...b.shared.removed.keys()]) if (b.editors.added.delete(id)) b.shared.removed.delete(id);
  for (const id of [...b.shared.added.keys()]) if (b.editors.removed.delete(id)) b.shared.added.delete(id);
  const base = {
    boardId: b.boardId,
    actorId: b.actorId,
    actorName: isGuestId(b.actorId) ? b.actorName : null,
    startedAt: b.startedAt,
    endedAt: b.lastAt,
  };
  const rows: ActivityRow[] = [];
  const app = b.via ? { app: b.via.name } : {};
  const shared = editSummary(b.shared, b.frameTitles);
  if (shared) rows.push({ ...base, id: newId(16), kind: 'edit', audience: 'all', summary: { ...shared, ...app } });
  const editors = editSummary(b.editors, b.frameTitles);
  if (editors) rows.push({ ...base, id: newId(16), kind: 'edit', audience: 'editors', summary: { ...editors, ...app } });
  if (b.comments > 0) rows.push({ ...base, id: newId(16), kind: 'comment', audience: 'all', summary: { comments: b.comments, threads: b.threads.size, ...app } });
  return rows;
}

/** Writes the bursts that have ended (all of them with `all`, e.g. at shutdown). */
export async function flushBursts(now = Date.now(), all = false): Promise<void> {
  const done: Burst[] = [];
  for (const [key, b] of bursts) {
    if (all || now - b.lastAt >= idleMs() || now - b.startedAt >= MAX_BURST_MS) {
      bursts.delete(key);
      done.push(b);
    }
  }
  if (done.length === 0) return;
  try {
    await repo.insertMany(done.flatMap(rowsOf));
  } catch (err) {
    logError('activity: could not store activity', err);
  }
}

/** Someone was given access to a board (share dialog, or their request approved). Stored at once. */
export async function recordShare(
  e: { boardId: string; byId: string; userId: string; role: string; via: 'invite' | 'request' },
  now = Date.now(),
): Promise<void> {
  await repo.insertMany([
    {
      id: newId(16),
      boardId: e.boardId,
      actorId: e.byId,
      actorName: null,
      kind: 'share',
      audience: 'all',
      summary: { userId: e.userId, role: e.role, via: e.via },
      startedAt: now,
      endedAt: now,
    },
  ]);
}

export const onBoardShared = (e: BoardSharedEvent) => recordShare({ boardId: e.boardId, byId: e.byId, userId: e.userId, role: e.role, via: 'invite' });
export const onAccessDecided = (e: AccessDecidedEvent) =>
  e.approved && e.role ? recordShare({ boardId: e.boardId, byId: e.deciderId, userId: e.requesterId, role: e.role, via: 'request' }) : undefined;

// ---- wording ----

const NOUNS: Record<string, [string, string]> = {
  sticky: ['sticky note', 'sticky notes'],
  shape: ['shape', 'shapes'],
  text: ['text box', 'text boxes'],
  connector: ['connector', 'connectors'],
  pen: ['drawing', 'drawings'],
  frame: ['frame', 'frames'],
  image: ['image', 'images'],
  card: ['card', 'cards'],
  emoji: ['reaction', 'reactions'],
  mindmap: ['mind map node', 'mind map nodes'],
  table: ['table', 'tables'],
  embed: ['link', 'links'],
  icon: ['icon', 'icons'],
  kanban: ['kanban board', 'kanban boards'],
  pdf: ['document', 'documents'],
  item: ['item', 'items'],
};
const noun = (type: string, n: number) => {
  const [one, many] = NOUNS[type] ?? NOUNS.item;
  return `${n} ${n === 1 ? one : many}`;
};

/** "12 sticky notes and 2 shapes"; more than three kinds: "15 items". */
function things(c: Record<string, number>): string {
  const entries = Object.entries(c).sort((a, b) => b[1] - a[1]);
  if (entries.length > 3) return noun('item', entries.reduce((s, [, n]) => s + n, 0));
  const parts = entries.map(([t, n]) => noun(t, n));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

const ROLE_VERB: Record<string, string> = { editor: 'edit', commenter: 'comment', viewer: 'view' };

/** The entry's text after the actor's name. `people`: names for share targets. */
export function describe(r: Pick<ActivityRow, 'kind' | 'summary' | 'audience'>, people: Map<string, string>): string {
  const s = r.summary;
  if (r.kind === 'comment') {
    const n = s.comments ?? 1;
    return n === 1 ? 'commented' : `left ${n} comments${(s.threads ?? 1) > 1 ? ` in ${s.threads} threads` : ''}`;
  }
  if (r.kind === 'share') {
    const who = (s.userId && people.get(s.userId)) || 'someone';
    const verb = s.role && ROLE_VERB[s.role] ? ROLE_VERB[s.role] : 'open it';
    return s.via === 'request' ? `let ${who} in to ${verb}` : `invited ${who} to ${verb}`;
  }
  const parts: string[] = [];
  if (s.added) parts.push(`added ${things(s.added)}`);
  if (s.changed) parts.push(`changed ${things(s.changed)}`);
  if (s.removed) parts.push(`removed ${things(s.removed)}`);
  const verbs = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  const where = s.frame !== undefined ? ` in frame “${s.frame || 'Untitled'}”` : s.frames ? ` across ${s.frames} frames` : '';
  return `${verbs}${where}${r.audience === 'editors' ? ' (hidden from viewers)' : ''}`;
}

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

async function present(rows: ActivityRow[], titles?: Map<string, string>): Promise<ActivityEntry[]> {
  const ids = new Set<string>();
  for (const r of rows) {
    ids.add(r.actorId);
    if (r.summary.userId) ids.add(r.summary.userId);
  }
  const [users, guests] = await Promise.all([getUsers([...ids].filter((id) => !isGuestId(id))), getGuests([...ids].filter(isGuestId))]);
  const names = new Map<string, string>([...users.values()].map((u) => [u.id, u.name]));
  return rows.map((r) => {
    const u = users.get(r.actorId);
    const g = guests.get(r.actorId);
    const name = u?.name ?? r.actorName ?? (g ? guestDisplayName(g.name) : 'Deleted user');
    return {
      id: r.id,
      boardId: r.boardId,
      ...(titles ? { boardTitle: titles.get(r.boardId) ?? 'Untitled board' } : {}),
      actor: u ? { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl } : null,
      actorName: r.summary.app ? actingFor({ name: r.summary.app }, name) : name,
      ...(r.summary.app ? { via: r.summary.app } : {}),
      kind: r.kind,
      text: describe(r, names),
      startedAt: r.startedAt,
      at: r.endedAt,
    };
  });
}

const canSeeHidden = (role: Role | null) => role === 'owner' || role === 'editor';
const pageOf = (opts: { before?: number | null; limit?: number }) => ({
  before: opts.before ?? null,
  limit: Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT)),
});

/** A board's activity for someone who can open it (`actorId`: an account or a guest). */
export async function boardActivity(boardId: string, actorId: string, opts: { before?: number | null; limit?: number } = {}): Promise<ActivityResponse> {
  const { role } = await getBoardAccess(boardId, actorId);
  if (!role) throw notFound('Board not found');
  const { before, limit } = pageOf(opts);
  const rows = await repo.recent([boardId], canSeeHidden(role) ? [boardId] : [], before, limit + 1);
  return { entries: await present(rows.slice(0, limit)), hasMore: rows.length > limit };
}

/** Recent activity across the workspace's boards the user can open. */
export async function workspaceActivity(
  workspaceId: string,
  userId: string,
  opts: { before?: number | null; limit?: number } = {},
): Promise<ActivityResponse> {
  const boards = await boardsOpenableIn(userId, workspaceId);
  const { before, limit } = pageOf(opts);
  const rows = await repo.recent(
    boards.map((b) => b.id),
    boards.filter((b) => canSeeHidden(b.role)).map((b) => b.id),
    before,
    limit + 1,
  );
  return { entries: await present(rows.slice(0, limit), new Map(boards.map((b) => [b.id, b.title]))), hasMore: rows.length > limit };
}

export function pruneOld(now = Date.now()): Promise<number> {
  return repo.pruneBefore(now - RETENTION_MS);
}
