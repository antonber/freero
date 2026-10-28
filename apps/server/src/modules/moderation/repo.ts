// The only writer of `moderation_items` and `moderation_actions` [S4]. Actions are append-only.
import type { ModerationActionKind, ModerationItemStatus, ReportReason, ReportTargetKind } from '@freero/shared';
import { one, query } from '../../platform/db';

export interface ItemRow {
  id: string;
  kind: 'report' | 'appeal';
  status: ModerationItemStatus;
  boardId: string | null;
  boardTitle: string;
  targetKind: ReportTargetKind | 'user';
  targetId: string | null;
  reason: ReportReason | null;
  message: string;
  reporterId: string | null;
  reporterKey: string | null;
  contactEmail: string | null;
  actionId: string | null;
  createdAt: number;
  resolvedAt: number | null;
  resolvedBy: string | null;
  resolutionNote: string;
}

interface ItemDb {
  id: string;
  kind: 'report' | 'appeal';
  status: ModerationItemStatus;
  board_id: string | null;
  board_title: string;
  target_kind: ReportTargetKind | 'user';
  target_id: string | null;
  reason: ReportReason | null;
  message: string;
  reporter_id: string | null;
  reporter_key: string | null;
  contact_email: string | null;
  action_id: string | null;
  created_at: Date;
  resolved_at: Date | null;
  resolved_by: string | null;
  resolution_note: string;
}

const toItem = (r: ItemDb): ItemRow => ({
  id: r.id,
  kind: r.kind,
  status: r.status,
  boardId: r.board_id,
  boardTitle: r.board_title,
  targetKind: r.target_kind,
  targetId: r.target_id,
  reason: r.reason,
  message: r.message,
  reporterId: r.reporter_id,
  reporterKey: r.reporter_key,
  contactEmail: r.contact_email,
  actionId: r.action_id,
  createdAt: r.created_at.getTime(),
  resolvedAt: r.resolved_at?.getTime() ?? null,
  resolvedBy: r.resolved_by,
  resolutionNote: r.resolution_note,
});

/**
 * Adds an item to the queue unless an open one with the same `dedupeKey` exists (a repeated report,
 * a second appeal against one action). Returns whether it was added.
 */
export async function insertItem(i: Omit<ItemRow, 'status' | 'resolvedAt' | 'resolvedBy' | 'resolutionNote'> & { dedupeKey: string }): Promise<boolean> {
  const row = await one(
    `INSERT INTO moderation_items (id, kind, board_id, board_title, target_kind, target_id, reason, message,
       reporter_id, reporter_key, contact_email, action_id, dedupe_key, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT (dedupe_key) WHERE status = 'open' DO NOTHING
     RETURNING id`,
    [
      i.id,
      i.kind,
      i.boardId,
      i.boardTitle,
      i.targetKind,
      i.targetId,
      i.reason,
      i.message,
      i.reporterId,
      i.reporterKey,
      i.contactEmail,
      i.actionId,
      i.dedupeKey,
      new Date(i.createdAt),
    ],
  );
  return row !== null;
}

export async function getItem(id: string): Promise<ItemRow | null> {
  const r = await one<ItemDb>(`SELECT * FROM moderation_items WHERE id = $1`, [id]);
  return r ? toItem(r) : null;
}

/** Open items oldest first (the queue), or closed ones most recently resolved first. */
export async function listItems(status: 'open' | 'closed', limit: number): Promise<ItemRow[]> {
  const rows =
    status === 'open'
      ? await query<ItemDb>(`SELECT * FROM moderation_items WHERE status = 'open' ORDER BY created_at LIMIT $1`, [limit])
      : await query<ItemDb>(`SELECT * FROM moderation_items WHERE status <> 'open' ORDER BY resolved_at DESC LIMIT $1`, [limit]);
  return rows.map(toItem);
}

export async function itemsForBoard(boardId: string): Promise<ItemRow[]> {
  return (await query<ItemDb>(`SELECT * FROM moderation_items WHERE board_id = $1 ORDER BY created_at DESC LIMIT 200`, [boardId])).map(toItem);
}

/** How many open items the board has (operators are mailed for the first one only). */
export async function countOpenForBoard(boardId: string): Promise<number> {
  const r = await one<{ n: number }>(`SELECT count(*)::int AS n FROM moderation_items WHERE board_id = $1 AND status = 'open'`, [boardId]);
  return r?.n ?? 0;
}

/** Whether an appeal against the action is waiting for review. */
export async function openAppealFor(actionId: string): Promise<boolean> {
  return (await one(`SELECT 1 FROM moderation_items WHERE action_id = $1 AND kind = 'appeal' AND status = 'open'`, [actionId])) !== null;
}

/** Closes an open item; null when it is not open (resolved meanwhile, or unknown). */
export async function resolveItem(id: string, status: Exclude<ModerationItemStatus, 'open'>, by: string, note: string, now: number): Promise<ItemRow | null> {
  const r = await one<ItemDb>(
    `UPDATE moderation_items SET status = $2, resolved_by = $3, resolution_note = $4, resolved_at = $5
     WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, status, by, note, new Date(now)],
  );
  return r ? toItem(r) : null;
}

// ---- actions (append-only) ----

export interface ActionRow {
  id: string;
  action: ModerationActionKind;
  targetId: string;
  boardId: string | null;
  subjectUserId: string | null;
  /** The subject as they were then (KAI-178). */
  subjectName: string | null;
  subjectEmail: string | null;
  operatorId: string | null;
  reason: ReportReason;
  statement: string;
  note: string;
  itemId: string | null;
  /** The action this one was part of (KAI-180). */
  parentId: string | null;
  createdAt: number;
}

interface ActionDb {
  id: string;
  action: ModerationActionKind;
  target_id: string;
  board_id: string | null;
  subject_user_id: string | null;
  subject_name: string | null;
  subject_email: string | null;
  operator_id: string | null;
  reason: ReportReason;
  statement: string;
  note: string;
  item_id: string | null;
  parent_id: string | null;
  created_at: Date;
}

const toAction = (r: ActionDb): ActionRow => ({
  id: r.id,
  action: r.action,
  targetId: r.target_id,
  boardId: r.board_id,
  subjectUserId: r.subject_user_id,
  subjectName: r.subject_name,
  subjectEmail: r.subject_email,
  operatorId: r.operator_id,
  reason: r.reason,
  statement: r.statement,
  note: r.note,
  itemId: r.item_id,
  parentId: r.parent_id,
  createdAt: r.created_at.getTime(),
});

export async function insertAction(a: ActionRow): Promise<void> {
  await query(
    `INSERT INTO moderation_actions (id, action, target_id, board_id, subject_user_id, subject_name, subject_email, operator_id,
       reason, statement, note, item_id, parent_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      a.id,
      a.action,
      a.targetId,
      a.boardId,
      a.subjectUserId,
      a.subjectName,
      a.subjectEmail,
      a.operatorId,
      a.reason,
      a.statement,
      a.note,
      a.itemId,
      a.parentId,
      new Date(a.createdAt),
    ],
  );
}

/** The actions taken as part of `parentId` (the boards of a suspension), oldest first. */
export async function childActions(parentId: string): Promise<ActionRow[]> {
  return (await query<ActionDb>(`SELECT * FROM moderation_actions WHERE parent_id = $1 ORDER BY created_at, id`, [parentId])).map(toAction);
}

/** Upload names among these with an open report or appeal about them: their kept copy is on hold (KAI-179). */
export async function uploadsUnderReview(names: string[]): Promise<Set<string>> {
  if (!names.length) return new Set();
  const rows = await query<{ target_id: string }>(
    `SELECT DISTINCT i.target_id FROM moderation_items i
     WHERE i.status = 'open' AND i.target_kind = 'upload' AND i.target_id = ANY($1::text[])`,
    [names],
  );
  return new Set(rows.map((r) => r.target_id));
}

export async function getAction(id: string): Promise<ActionRow | null> {
  const r = await one<ActionDb>(`SELECT * FROM moderation_actions WHERE id = $1`, [id]);
  return r ? toAction(r) : null;
}

export async function getActions(ids: string[]): Promise<ActionRow[]> {
  if (!ids.length) return [];
  return (await query<ActionDb>(`SELECT * FROM moderation_actions WHERE id = ANY($1::text[])`, [ids])).map(toAction);
}

/** Actions on a target (or on anything of a board), newest first. */
export async function actionsAbout(targetOrBoardId: string): Promise<ActionRow[]> {
  return (
    await query<ActionDb>(
      `SELECT * FROM moderation_actions WHERE target_id = $1 OR board_id = $1 ORDER BY created_at DESC LIMIT 200`,
      [targetOrBoardId],
    )
  ).map(toAction);
}

/** The newest action of one of `kinds` on the target, after `since` (a reversal of an earlier one). */
export async function laterAction(targetId: string, kinds: ModerationActionKind[], since: number): Promise<ActionRow | null> {
  const r = await one<ActionDb>(
    `SELECT * FROM moderation_actions WHERE target_id = $1 AND action = ANY($2::text[]) AND created_at >= $3 ORDER BY created_at DESC LIMIT 1`,
    [targetId, kinds, new Date(since)],
  );
  return r ? toAction(r) : null;
}
