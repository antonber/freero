// "Changes since your last visit" (contract: @freero/shared api.ts, CatchUpSummary). The marker is
// when the person's board socket last closed (realtime's onBoardLeft → board_seen); what changed
// since is read from the activity feed — the same attributed bursts, so only what OTHER people did
// (and apps acting for anyone, the reader included: they did it while you were away) is news, and
// a reader sees only the rows their role may (hidden frames' contents: owners and editors).
//
// Cost: the summary is one indexed read of the board's activity rows since the marker, offered on
// every open. The item list is computed only when someone asks for it: the board as they see it
// now, read through the outline, plus — for removed items' text — the last version kept before
// the marker (one snapshot, viewer rules: never hidden frames' contents or drafts).
import { flattenOutline, MAX_CATCH_UP_ITEMS, type CatchUpChanges, type CatchUpItem, type CatchUpSummary, type OutlineEntry, type Role } from '@freero/shared';
import { notFound } from '../../platform/http';
import { getBoardAccess, getBoardTitle } from '../boards/index';
import { outlineOfView } from '../outline/index';
import { listBoardSnapshots, loadBoardSnapshot, readBoardView, viewOfState } from '../realtime/index';
import * as repo from './repo';
import type { ActivityRow } from './repo';
import { actorsOf, canSeeHidden } from './service';

/** Most activity rows one catch-up reads (a busy board's week); older ones beyond are left out. */
const MAX_ROWS = 2000;

/** Another person did it, or an app did it for anyone (the reader too: it happened while they were away). */
export const fromOthers = (r: ActivityRow, userId: string) => r.actorId !== userId || !!r.summary.app;

export interface NetItem {
  op: 'added' | 'changed' | 'removed';
  /** Element type (removed items: from the row; others: filled from the board). */
  type: string;
  /** Rows that touched it, oldest first. */
  rows: ActivityRow[];
}

export interface NetChanges {
  items: Map<string, NetItem>;
  comments: number;
  /** Some row listed fewer items than it touched (or predates item lists). */
  truncated: boolean;
  /** Items counted by rows that predate item lists (no ids): counted, not listed. */
  unlisted: { added: number; changed: number; removed: number };
}

const sum = (c: Record<string, number> | undefined) => Object.values(c ?? {}).reduce((s, n) => s + n, 0);

/**
 * The net of these rows (oldest first), per item: added then removed is nothing, removed then
 * added again (undo) is a change, added then changed stays added.
 */
export function netChanges(rows: ActivityRow[]): NetChanges {
  const items = new Map<string, NetItem>();
  const unlisted = { added: 0, changed: 0, removed: 0 };
  let comments = 0;
  let truncated = false;
  const touch = (id: string, op: NetItem['op'], type: string, r: ActivityRow) => {
    const prev = items.get(id);
    const rows = [...(prev?.rows ?? []), r];
    if (!prev) return void items.set(id, { op, type, rows });
    if (op === 'removed') {
      if (prev.op === 'added') items.delete(id);
      else items.set(id, { op: 'removed', type, rows });
    } else if (op === 'added') items.set(id, { op: prev.op === 'removed' ? 'changed' : prev.op, type: prev.type, rows });
    else items.set(id, { op: prev.op === 'added' ? 'added' : 'changed', type: prev.type, rows });
  };
  for (const r of rows) {
    if (r.kind === 'comment') {
      comments += r.summary.comments ?? 0;
      continue;
    }
    if (r.kind !== 'edit') continue;
    const ids = r.summary.ids;
    if (!ids) {
      truncated = true;
      unlisted.added += sum(r.summary.added);
      unlisted.changed += sum(r.summary.changed);
      unlisted.removed += sum(r.summary.removed);
      continue;
    }
    if (ids.more) truncated = true;
    for (const id of ids.added ?? []) touch(id, 'added', 'item', r);
    for (const id of ids.changed ?? []) touch(id, 'changed', 'item', r);
    for (const [id, type] of Object.entries(ids.removed ?? {})) touch(id, 'removed', type, r);
  }
  return { items, comments, truncated, unlisted };
}

interface Read {
  since: number | null;
  rows: ActivityRow[];
  role: Role;
  /** More rows than one catch-up reads. */
  cut?: boolean;
}

async function readSince(boardId: string, userId: string, from?: number): Promise<Read> {
  const { role } = await getBoardAccess(boardId, userId);
  if (!role) throw notFound('Board not found');
  const since = from ?? (await repo.seenAt(boardId, userId));
  if (since === null) return { since, rows: [], role };
  const rows = await repo.since([boardId], canSeeHidden(role) ? [boardId] : [], since, ['edit', 'comment'], MAX_ROWS);
  return { since, rows: rows.filter((r) => fromOthers(r, userId)), role, cut: rows.length === MAX_ROWS };
}

async function summarize(read: Read, net: NetChanges): Promise<CatchUpSummary> {
  const counts = { ...net.unlisted, comments: net.comments };
  for (const it of net.items.values()) counts[it.op]++;
  const actors = await actorsOf(read.rows);
  const people = new Map<string, { n: number; person: CatchUpSummary['people'][number] }>();
  for (const r of read.rows) {
    const name = actors.name(r);
    const p = people.get(name) ?? { n: 0, person: { ...(actors.profile(r) ?? { id: null, color: '#8a89a3', avatarUrl: null }), name } };
    p.n++;
    people.set(name, p);
  }
  return {
    since: read.since,
    counts,
    people: [...people.values()].sort((a, b) => b.n - a.n).map((p) => p.person),
  };
}

/** Whether others changed the board since the reader last had it open, and who (cheap: activity rows only). */
export async function catchUpSummary(boardId: string, userId: string): Promise<CatchUpSummary> {
  const read = await readSince(boardId, userId);
  return summarize(read, netChanges(read.rows));
}

/**
 * What exactly changed since then, as the reader may see the board now. `since` [#126]: from this
 * moment instead of the last visit (the AI catch-up's "last 7 days").
 */
export async function catchUpChanges(boardId: string, userId: string, opts: { since?: number } = {}): Promise<CatchUpChanges> {
  const read = await readSince(boardId, userId, opts.since);
  const net = netChanges(read.rows);
  const summary = await summarize(read, net);
  const out: CatchUpChanges = { ...summary, added: [], changed: [], removed: [], truncated: net.truncated || !!read.cut };
  if (net.items.size === 0 || read.since === null) return out;
  const meta = { id: boardId, title: (await getBoardTitle(boardId)) ?? '' };
  const view = await readBoardView(boardId, { userId, role: read.role });
  // Never a private draft (the reader's own included): what others changed is on the shared board.
  const onBoard = new Map(view.elements.filter((e) => e.layer !== 'private').map((e) => [e.el.id, e.el.type]));
  const frameOf = new Map(view.elements.filter((e) => e.el.frameId).map((e) => [e.el.id, e.el.frameId!]));
  const now = flattenOutline(await outlineOfView(meta, view));
  // Removed items (and changed ones' text before) as they read at the last version kept before the visit.
  const then = [...net.items.values()].some((i) => i.op !== 'added') ? await versionBefore(boardId, read.since, meta) : new Map<string, OutlineEntry>();
  const actors = await actorsOf(read.rows);
  for (const [id, it] of net.items) {
    const by = [...new Set(it.rows.map(actors.name).reverse())];
    const at = it.rows[it.rows.length - 1].endedAt;
    if (it.op === 'removed') {
      if (onBoard.has(id)) continue; // back on the board (put back by the reader themselves)
      const old = then.get(id);
      push(out.removed, { id, kind: old?.kind ?? it.type, text: old?.text ?? '', ...(old?.frame ? { frame: old.frame } : {}), by, at }, out);
      continue;
    }
    const type = onBoard.get(id);
    if (!type) continue; // gone since, or not something this reader may see now
    const cur = now.get(id);
    const old = then.get(id);
    const frameId = frameOf.get(id);
    const item: CatchUpItem = { id, kind: cur?.kind ?? type, text: cur?.text ?? '', ...(cur?.frame ? { frame: cur.frame } : {}), ...(frameId ? { frameId } : {}), by, at };
    if (it.op === 'changed' && old && cur && old.text !== cur.text) item.before = old.text;
    push(it.op === 'added' ? out.added : out.changed, item, out);
  }
  for (const list of [out.added, out.changed, out.removed]) list.sort((a, b) => b.at - a.at);
  return out;
}

function push(list: CatchUpItem[], item: CatchUpItem, out: CatchUpChanges): void {
  if (list.length < MAX_CATCH_UP_ITEMS) list.push(item);
  else out.truncated = true;
}

/** The board as everyone saw it at the newest version kept at or before `at` (empty: none kept). */
async function versionBefore(boardId: string, at: number, meta: { id: string; title: string }): Promise<Map<string, OutlineEntry>> {
  const snap = (await listBoardSnapshots(boardId)).find((s) => s.createdAt <= at);
  const state = snap ? await loadBoardSnapshot(boardId, snap.id) : null;
  return state ? flattenOutline(await outlineOfView(meta, viewOfState(state))) : new Map();
}

export interface BoardChanges {
  boardId: string;
  /** Who made them, most active first. */
  people: string[];
  counts: CatchUpSummary['counts'];
}

/**
 * What others did on these boards (each with the reader's role) since `since`, per board, for
 * the "changes on your boards" email; boards nobody else changed are left out. Same rules as the
 * catch-up: attributed rows only, hidden frames' contents for owners and editors.
 */
export async function boardChangesSince(userId: string, boards: Array<{ id: string; role: Role }>, since: number): Promise<BoardChanges[]> {
  const rows = (
    await repo.since(
      boards.map((b) => b.id),
      boards.filter((b) => canSeeHidden(b.role)).map((b) => b.id),
      since,
      ['edit', 'comment'],
      MAX_ROWS * 5,
    )
  ).filter((r) => fromOthers(r, userId));
  const byBoard = new Map<string, ActivityRow[]>();
  for (const r of rows) byBoard.set(r.boardId, [...(byBoard.get(r.boardId) ?? []), r]);
  const out: BoardChanges[] = [];
  for (const [boardId, list] of byBoard) {
    const s = await summarize({ since, rows: list, role: 'viewer' }, netChanges(list));
    const c = s.counts;
    if (c.added + c.changed + c.removed + c.comments === 0) continue;
    out.push({ boardId, people: s.people.map((p) => p.name), counts: c });
  }
  return out;
}

/** Realtime: the account's board socket closed — the moment "since your last visit" starts. */
export function onBoardLeft(e: { boardId: string; userId: string; at: number }): Promise<void> {
  return repo.markSeen(e.boardId, e.userId, e.at);
}
