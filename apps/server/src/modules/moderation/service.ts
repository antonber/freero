// Reports, the operator queue, operator actions and appeals (KAI-142).
//
// Operators are accounts whose VERIFIED address is listed in OPERATOR_EMAILS (config): nothing in
// the database makes someone an operator, so the list is reviewed and deployed like any other
// configuration, and an unverified signup with an operator's address gets nothing.
//
// Actions are calls into the modules that own the data — boards (take down, block the link),
// uploads (remove a file), auth (suspend an account) — never writes to their tables [S4]. Each is
// recorded in moderation_actions (append-only; the queue's history and appeals read it) and as a
// platform audit event (`moderation.<action>`, platform/audit.ts), and the person affected gets a notice with the reason and, for adverse actions, a signed appeal
// link that works without signing in (a suspended account can still appeal).
import {
  MAX_REPORT_NOTE,
  REPORT_REASONS,
  type Account,
  type AppealInfo,
  type ModeratedBoard,
  type ModeratedUpload,
  type ModeratedUser,
  type ModerationActionKind,
  type ModerationActionRecord,
  type ModerationItem,
  type ReportReason,
  type ReportTargetKind,
  type SuspensionBoards,
  type User,
} from '@freero/shared';
import type { Readable } from 'node:stream';
import { getConfig } from '../../platform/config';
import { audit } from '../../platform/audit';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { log, logError } from '../../platform/log';
import { mac, macMatches } from '../../platform/secrets';
import { findUserByEmail, getUsers, normalizeEmail, suspendedUserIds, suspendUser, unsuspendUser } from '../auth/index';
import {
  blockBoardLink,
  boardForModeration,
  deleteTakenDownBoard,
  liveBoardsOwnedBy,
  reportableBoard,
  restoreTakenDownBoard,
  takeDownBoard,
  unblockBoardLink,
  type ModerationBoardState,
} from '../boards/index';
import { notify } from '../notifications/index';
import { snapshotBoardDoc } from '../realtime/index';
import { keptCopiesRemovedBefore, openUploadForModeration, purgeRemovedUpload, removeUpload, restoreUpload, uploadForModeration, uploadName } from '../uploads/index';
import { alertOperators, isAdverse, sendActionNotice, sendAppealUpheld, sendReportOutcome } from './notices';
import * as repo from './repo';

const QUEUE_LIMIT = 200;
const MAX_STATEMENT = 2000;
const MAX_APPEAL = 4000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ELEMENT_ID_RE = /^[\w-]{1,100}$/;
const COMMENT_ID_RE = /^[\w-]{1,100}:[\w-]{1,100}$/;
const TARGET_KINDS: ReportTargetKind[] = ['board', 'element', 'upload', 'comment'];
const ACTIONS: ModerationActionKind[] = [
  'board.disable_link',
  'board.restore_link',
  'board.take_down',
  'board.restore',
  'board.delete',
  'upload.remove',
  'upload.restore',
  'upload.purge',
  'user.suspend',
  'user.restore',
];
/** What undoes an action (an appeal against an action that was undone since is moot). */
const REVERSAL: Partial<Record<ModerationActionKind, ModerationActionKind>> = {
  'board.disable_link': 'board.restore_link',
  'board.take_down': 'board.restore',
  'upload.remove': 'upload.restore',
  'user.suspend': 'user.restore',
};

const isReason = (v: unknown): v is ReportReason => REPORT_REASONS.some((r) => r.id === v);
const text = (v: unknown, name: string, max: number): string => {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw badRequest(`${name} must be text`);
  if (v.length > max) throw badRequest(`${name} is too long (max ${max} characters)`);
  return v.trim();
};

// ---- operators ----

/** Operators: a verified address listed in OPERATOR_EMAILS. */
export function isOperator(user: Pick<Account, 'email' | 'emailVerified'>): boolean {
  return user.emailVerified && getConfig().operatorEmails.includes(user.email.toLowerCase());
}

// ---- reports ----

const boardNotFound = () => notFound('Board not found');

/**
 * Files a report from someone who can open the board (`userId` null: a visitor on its public
 * link). Unknown boards and boards they can't open get the same 404. A repeated report of the same
 * thing by the same person (or address) while the first is open adds nothing. Operators are
 * mailed when a board gets its first open report.
 */
export async function submitReport(body: Record<string, unknown>, who: { userId: string | null; ip: string }): Promise<void> {
  const boardId = typeof body.boardId === 'string' ? body.boardId : '';
  const t = (body.target ?? { kind: 'board' }) as { kind?: unknown; id?: unknown };
  const kind = t.kind as ReportTargetKind;
  if (!TARGET_KINDS.includes(kind)) throw badRequest(`target.kind must be one of ${TARGET_KINDS.join(', ')}`);
  let targetId: string | null = null;
  if (kind !== 'board') {
    const id = typeof t.id === 'string' ? t.id : '';
    targetId = kind === 'upload' ? uploadName(id) : (kind === 'element' ? ELEMENT_ID_RE : COMMENT_ID_RE).test(id) ? id : null;
    if (!targetId) throw badRequest(`target.id is not a valid ${kind} id`);
  }
  if (!isReason(body.reason)) throw badRequest(`reason must be one of ${REPORT_REASONS.map((r) => r.id).join(', ')}`);
  const note = text(body.note, 'note', MAX_REPORT_NOTE);
  const contact = who.userId ? '' : normalizeEmail(text(body.contactEmail, 'contactEmail', 254));
  if (contact && !EMAIL_RE.test(contact)) throw badRequest('contactEmail must be an email address');

  const board = boardId ? await reportableBoard(boardId, who.userId) : null;
  if (!board) throw boardNotFound();
  // Who reported, without keeping the address itself: enough to see one source flooding the queue.
  const reporterKey = mac(`moderation.reporter:${who.ip}`).toString('base64url').slice(0, 22);
  const reporter = who.userId ? `u:${who.userId}` : `k:${reporterKey}`;
  const added = await repo.insertItem({
    id: newId(16),
    kind: 'report',
    boardId: board.id,
    boardTitle: board.title,
    targetKind: kind,
    targetId,
    reason: body.reason,
    message: note,
    reporterId: who.userId,
    reporterKey,
    contactEmail: contact || null,
    actionId: null,
    createdAt: Date.now(),
    dedupeKey: `report:${board.id}:${kind}:${targetId ?? ''}:${reporter}`,
  });
  if (added) {
    log(`moderation: report on board ${board.id} (${kind}${targetId ? ` ${targetId}` : ''}, ${body.reason})`);
    if ((await repo.countOpenForBoard(board.id)) === 1) alertOperators({ kind: 'report', boardTitle: board.title, reason: body.reason });
  }
}

// ---- presenting the queue ----

const moderatedUser = (u: User | undefined, suspended: Set<string>): ModeratedUser | null =>
  u ? { id: u.id, name: u.name, email: u.email, suspended: suspended.has(u.id) } : null;

async function people(ids: Array<string | null | undefined>): Promise<{ users: Map<string, User>; suspended: Set<string> }> {
  const wanted = [...new Set(ids.filter((x): x is string => !!x))];
  const [users, suspended] = await Promise.all([getUsers(wanted), suspendedUserIds(wanted)]);
  return { users, suspended };
}

function presentBoard(b: ModerationBoardState, p: { users: Map<string, User>; suspended: Set<string> }): ModeratedBoard {
  return {
    id: b.id,
    title: b.title,
    owner: moderatedUser(p.users.get(b.ownerId), p.suspended),
    linkAccess: b.linkAccess,
    linkBlocked: b.linkBlocked,
    removedAt: b.removedAt,
    deletedAt: b.deletedAt,
    thumbnail: b.thumbnail,
  };
}

function presentAction(a: repo.ActionRow, users: Map<string, User>): ModerationActionRecord {
  const op = a.operatorId ? users.get(a.operatorId) : undefined;
  return {
    id: a.id,
    action: a.action,
    targetId: a.targetId,
    boardId: a.boardId,
    subjectUserId: a.subjectUserId,
    subject: a.subjectEmail ? { name: a.subjectName ?? '', email: a.subjectEmail } : null,
    operator: op ? { id: op.id, name: op.name } : null,
    parentId: a.parentId,
    reason: a.reason,
    statement: a.statement,
    note: a.note,
    createdAt: a.createdAt,
  };
}

async function presentItems(items: repo.ItemRow[]): Promise<ModerationItem[]> {
  const boardIds = [...new Set(items.flatMap((i) => (i.boardId ? [i.boardId] : [])))];
  const boards = new Map<string, ModerationBoardState>();
  for (const id of boardIds) {
    const b = await boardForModeration(id);
    if (b) boards.set(id, b);
  }
  const actions = new Map((await repo.getActions(items.flatMap((i) => (i.actionId ? [i.actionId] : [])))).map((a) => [a.id, a]));
  const p = await people([
    ...items.map((i) => i.reporterId),
    ...[...boards.values()].map((b) => b.ownerId),
    ...[...actions.values()].map((a) => a.operatorId),
  ]);
  return items.map((i) => {
    const reporter = i.reporterId ? p.users.get(i.reporterId) : undefined;
    const board = i.boardId ? boards.get(i.boardId) : undefined;
    const action = i.actionId ? actions.get(i.actionId) : undefined;
    return {
      id: i.id,
      kind: i.kind,
      status: i.status,
      boardId: i.boardId,
      boardTitle: board?.title ?? i.boardTitle,
      target: i.targetId ? { kind: i.targetKind, id: i.targetId } : { kind: i.targetKind },
      reason: i.reason,
      message: i.message,
      reporter: reporter ? { id: reporter.id, name: reporter.name, email: reporter.email } : null,
      contactEmail: i.contactEmail,
      action: action ? presentAction(action, p.users) : null,
      createdAt: i.createdAt,
      resolvedAt: i.resolvedAt,
      resolutionNote: i.resolutionNote,
      board: board ? presentBoard(board, p) : null,
    };
  });
}

export async function queue(status: 'open' | 'closed'): Promise<ModerationItem[]> {
  return presentItems(await repo.listItems(status, QUEUE_LIMIT));
}

export async function boardDetail(boardId: string): Promise<{ board: ModeratedBoard; items: ModerationItem[]; actions: ModerationActionRecord[] }> {
  const b = await boardForModeration(boardId);
  if (!b) throw boardNotFound();
  const [items, actions] = await Promise.all([repo.itemsForBoard(boardId), repo.actionsAbout(boardId)]);
  const p = await people([b.ownerId, ...actions.map((a) => a.operatorId)]);
  return { board: presentBoard(b, p), items: await presentItems(items), actions: actions.map((a) => presentAction(a, p.users)) };
}

/** The board's shared document as collaborators see it right now (layers — private drafts — never). */
export async function boardPreview(boardId: string): Promise<Uint8Array> {
  if (!(await boardForModeration(boardId))) throw boardNotFound();
  return (await snapshotBoardDoc(boardId)) ?? new Uint8Array();
}

export async function uploadDetail(nameOrUrl: string): Promise<ModeratedUpload> {
  const name = uploadName(nameOrUrl);
  const u = name ? await uploadForModeration(name) : null;
  if (!u?.exists) throw notFound('File not found');
  const p = await people([u.ownerId]);
  return {
    name: u.name,
    url: `/uploads/${u.name}`,
    owner: u.ownerId ? moderatedUser(p.users.get(u.ownerId), p.suspended) : null,
    contentType: u.contentType,
    bytes: u.bytes,
    removedAt: u.removedAt,
    restorable: u.restorable,
  };
}

/**
 * A reported file's bytes for an operator to review (KAI-205): attachments are never served at
 * /uploads, and a removed file's URL answers 410, so this is the only way to see what a report is
 * about. Always a download (the route never renders it), always in the audit trail.
 */
export async function uploadFileForReview(operatorId: string, nameOrUrl: string): Promise<{ name: string; body: Readable; size: number | null }> {
  const name = uploadName(nameOrUrl);
  const file = name ? await openUploadForModeration(name) : null;
  if (!name || !file) throw notFound('File not found');
  await audit({
    action: 'moderation.upload.download',
    actor: { kind: 'user', userId: operatorId },
    userId: file.ownerId ?? '',
    detail: { upload: name },
  });
  return { name, body: file.body, size: file.size };
}

export async function userByEmail(email: unknown): Promise<ModeratedUser> {
  const u = typeof email === 'string' && email ? await findUserByEmail(email) : null;
  if (!u) throw notFound('No account with that email address');
  const suspended = await suspendedUserIds([u.id]);
  return moderatedUser(u, suspended)!;
}

// ---- actions ----

const nothingToDo: Record<ModerationActionKind, string> = {
  'board.disable_link': 'Link sharing is already off for this board.',
  'board.restore_link': 'This board’s link sharing isn’t blocked.',
  'board.take_down': 'This board is already taken down.',
  'board.restore': 'This board isn’t taken down.',
  'board.delete': 'Only a board that is taken down can be deleted for good, and this one isn’t (or it is gone already).',
  'upload.remove': 'This file is already removed.',
  'upload.restore': 'This file isn’t removed, or its kept copy was purged.',
  'upload.purge': 'This file isn’t removed, or its kept copy was purged already.',
  'user.suspend': 'This account is already suspended.',
  'user.restore': 'This account isn’t suspended.',
};

/** Runs the action through the owning module; who it affects and which board it is about. */
async function execute(
  kind: ModerationActionKind,
  targetId: string,
  operatorId: string,
  boardHint: string | null,
): Promise<{ changed: boolean; boardId: string | null; boardTitle: string | null; subjects: string[]; targetId: string }> {
  if (kind.startsWith('board.')) {
    const b = await boardForModeration(targetId);
    if (!b) throw boardNotFound();
    const changed =
      kind === 'board.disable_link'
        ? await blockBoardLink(b.id)
        : kind === 'board.restore_link'
          ? await unblockBoardLink(b.id)
          : kind === 'board.take_down'
            ? await takeDownBoard(b.id)
            : kind === 'board.delete'
              ? await deleteTakenDownBoard(b.id)
              : await restoreTakenDownBoard(b.id);
    return { changed, boardId: b.id, boardTitle: b.title, subjects: [b.ownerId], targetId: b.id };
  }
  if (kind.startsWith('upload.')) {
    const name = uploadName(targetId);
    const u = name ? await uploadForModeration(name) : null;
    if (!name || !u?.exists) throw notFound('File not found');
    const board = boardHint ? await boardForModeration(boardHint) : null;
    const changed = kind === 'upload.remove' ? await removeUpload(name) : kind === 'upload.restore' ? await restoreUpload(name) : await purgeRemovedUpload(name);
    // The uploader; for a file without one (a thumbnail, a file from before quotas), the owner of
    // the board it was reported on.
    const subjects = [u.ownerId ?? board?.ownerId].filter((x): x is string => !!x);
    return { changed, boardId: board?.id ?? null, boardTitle: board?.title ?? null, subjects, targetId: name };
  }
  if (targetId === operatorId) throw badRequest('You can’t suspend or restore your own account');
  if (!(await getUsers([targetId])).has(targetId)) throw notFound('No such account');
  const changed = kind === 'user.suspend' ? await suspendUser(targetId) : await unsuspendUser(targetId);
  return { changed, boardId: null, boardTitle: null, subjects: [targetId], targetId };
}

/** Records an action (append-only) and its platform audit event (`moderation.<action>`). */
async function record_(a: {
  action: ModerationActionKind;
  targetId: string;
  boardId: string | null;
  subject: { id: string | null; name: string | null; email: string | null } | null;
  operatorId: string | null;
  reason: ReportReason;
  statement: string;
  note: string;
  itemId: string | null;
  parentId: string | null;
}): Promise<repo.ActionRow> {
  const row: repo.ActionRow = {
    id: newId(16),
    action: a.action,
    targetId: a.targetId,
    boardId: a.boardId,
    subjectUserId: a.subject?.id ?? null,
    subjectName: a.subject?.name ?? null,
    subjectEmail: a.subject?.email ?? null,
    operatorId: a.operatorId,
    reason: a.reason,
    statement: a.statement,
    note: a.note,
    itemId: a.itemId,
    parentId: a.parentId,
    createdAt: Date.now(),
  };
  await repo.insertAction(row);
  log(`moderation: ${a.operatorId ?? 'freero'} ${a.action} ${a.targetId}`);
  // The audit trail (KAI-48 stores these through platform/audit's sinks); never throws.
  await audit({
    action: `moderation.${a.action}`,
    actor: a.operatorId ? { kind: 'user', userId: a.operatorId } : { kind: 'system' },
    userId: row.subjectUserId ?? '',
    detail: { actionId: row.id, targetId: row.targetId, boardId: row.boardId, reason: row.reason, item: a.itemId, parent: a.parentId },
  });
  return row;
}

/** Takes an action, records it, closes the queue item it answers and tells the people affected. */
export async function act(operatorId: string, body: Record<string, unknown>): Promise<ModerationActionRecord> {
  const kind = body.action as ModerationActionKind;
  if (!ACTIONS.includes(kind)) throw badRequest(`action must be one of ${ACTIONS.join(', ')}`);
  const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
  if (!targetId) throw badRequest('targetId is required');
  if (!isReason(body.reason)) throw badRequest(`reason must be one of ${REPORT_REASONS.map((r) => r.id).join(', ')}`);
  const statement = text(body.statement, 'statement', MAX_STATEMENT);
  if (isAdverse(kind) && !statement) throw badRequest('Write the statement the person affected will read');
  const note = text(body.note, 'note', MAX_STATEMENT);
  const itemId = typeof body.itemId === 'string' && body.itemId ? body.itemId : null;
  const boardHint = typeof body.boardId === 'string' && body.boardId ? body.boardId : null;
  const boards = (body.boards ?? null) as SuspensionBoards | null;
  if (boards !== null && (kind !== 'user.suspend' || (boards !== 'take_down' && boards !== 'disable_link')))
    throw badRequest('boards (take_down or disable_link) only goes with user.suspend');

  const done = await execute(kind, targetId, operatorId, boardHint);
  if (!done.changed) throw new HttpError(409, nothingToDo[kind]);
  const subjectUserId = done.subjects[0] ?? null;
  const record = await record_({
    action: kind,
    targetId: done.targetId,
    boardId: done.boardId,
    // Who it is about, as they are now: the record keeps naming them after their account is gone.
    subject: subjectUserId ? ((await getUsers([subjectUserId])).get(subjectUserId) ?? null) : null,
    operatorId,
    reason: body.reason,
    statement,
    note,
    itemId,
    parentId: null,
  });

  // KAI-180: the account's boards go with the suspension, and come back when it is lifted.
  let boardsChanged = 0;
  if (kind === 'user.suspend' && boards) boardsChanged = await actOnBoardsOf(record, boards);
  if (kind === 'user.restore') boardsChanged = await undoBoardsOfSuspension(record);

  if (itemId) {
    const item = await repo.resolveItem(itemId, 'actioned', operatorId, statement, record.createdAt);
    if (item?.kind === 'report') await answerReporter(item, true);
  }
  const extra = !boardsChanged
    ? undefined
    : kind === 'user.restore'
      ? `Your ${plural(boardsChanged)} that were removed or closed to their link with the suspension are back as they were.`
      : boards === 'take_down'
        ? `Your ${plural(boardsChanged)} were removed for review with it.`
        : `Link sharing was turned off for your ${plural(boardsChanged)} with it.`;
  await tellAffected(record, done.subjects, done.boardTitle, extra);
  const users = (await people([operatorId])).users;
  return presentAction(record, users);
}

const plural = (n: number) => (n === 1 ? 'board' : `${n} boards`);

/**
 * Takes down (or turns off the link of) every board the suspended account owns that is in service,
 * each recorded as its own action under the suspension (`parentId`), so lifting it undoes exactly
 * these. Boards already taken down / link-blocked are left out (they have their own decisions).
 * The person hears about them in the suspension's notice, not once per board. Returns how many.
 */
async function actOnBoardsOf(suspension: repo.ActionRow, mode: SuspensionBoards): Promise<number> {
  const subject = (await getUsers([suspension.targetId])).get(suspension.targetId) ?? null;
  let n = 0;
  for (const b of await liveBoardsOwnedBy(suspension.targetId)) {
    if (mode === 'disable_link' && !b.linkShared) continue;
    const changed = mode === 'take_down' ? await takeDownBoard(b.id) : await blockBoardLink(b.id);
    if (!changed) continue;
    n++;
    await record_({
      action: mode === 'take_down' ? 'board.take_down' : 'board.disable_link',
      targetId: b.id,
      boardId: b.id,
      subject,
      operatorId: suspension.operatorId,
      reason: suspension.reason,
      statement: suspension.statement,
      note: suspension.note,
      itemId: null,
      parentId: suspension.id,
    });
  }
  return n;
}

/**
 * Lifting a suspension restores the boards it took down (or whose link it turned off) — those not
 * restored or deleted since — each recorded under the lift. Returns how many came back.
 */
async function undoBoardsOfSuspension(lift: repo.ActionRow): Promise<number> {
  const suspension = await repo.laterAction(lift.targetId, ['user.suspend'], 0);
  if (!suspension) return 0;
  const subject = (await getUsers([lift.targetId])).get(lift.targetId) ?? null;
  let n = 0;
  for (const child of await repo.childActions(suspension.id)) {
    const undo = REVERSAL[child.action];
    if (!undo || (await reversed(child))) continue;
    const changed = undo === 'board.restore' ? await restoreTakenDownBoard(child.targetId) : await unblockBoardLink(child.targetId);
    if (!changed) continue;
    n++;
    await record_({
      action: undo,
      targetId: child.targetId,
      boardId: child.boardId,
      subject,
      operatorId: lift.operatorId,
      reason: lift.reason,
      statement: lift.statement,
      note: lift.note,
      itemId: null,
      parentId: lift.id,
    });
  }
  return n;
}

/**
 * Retention of kept copies (KAI-179): deletes for good the kept copy of every file removed more than
 * MODERATION_KEEP_REMOVED_DAYS ago, unless a report or appeal about it is still open (it is under
 * review: an appeal granted later needs the bytes to restore). Each deletion is recorded as an
 * automatic `upload.purge` (no operator) about whom the removal was about; nobody is mailed (they
 * were told when it was removed). Idempotent; one instance at a time (moderation/init.ts).
 */
export async function purgeExpiredKeptCopies(now = Date.now()): Promise<number> {
  const keepMs = getConfig().moderationKeepRemovedMs;
  const due = await keptCopiesRemovedBefore(now - keepMs);
  const held = await repo.uploadsUnderReview(due.map((u) => u.name));
  let purged = 0;
  for (const u of due) {
    if (held.has(u.name) || !(await purgeRemovedUpload(u.name))) continue;
    purged++;
    const removal = await repo.laterAction(u.name, ['upload.remove'], 0);
    await record_({
      action: 'upload.purge',
      targetId: u.name,
      boardId: removal?.boardId ?? null,
      subject: removal ? { id: removal.subjectUserId, name: removal.subjectName, email: removal.subjectEmail } : null,
      operatorId: null,
      reason: removal?.reason ?? 'other',
      statement: '',
      note: `Automatic: kept for ${Math.round(keepMs / 86_400_000)} day(s) after the removal (MODERATION_KEEP_REMOVED_DAYS).`,
      itemId: null,
      parentId: null,
    });
  }
  return purged;
}

/** The appeal page for an action: signed, so it works without a session (suspended accounts). */
export function appealToken(actionId: string): string {
  return `${actionId}.${mac(`moderation.appeal:${actionId}`).toString('base64url')}`;
}

function actionIdOf(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const [id, sig] = token.split('.');
  return id && sig && macMatches(`moderation.appeal:${id}`, Buffer.from(sig, 'base64url')) ? id : null;
}

const appealable = (a: ModerationActionKind) => REVERSAL[a] !== undefined;

async function tellAffected(a: repo.ActionRow, subjects: string[], boardTitle: string | null, extra?: string): Promise<void> {
  if (a.action === 'upload.purge') return; // they were told when it was removed
  const appealPath = appealable(a.action) ? `/appeal?t=${encodeURIComponent(appealToken(a.id))}` : null;
  const users = await getUsers(subjects);
  for (const userId of new Set(subjects)) {
    const u = users.get(userId);
    if (!u) continue;
    sendActionNotice(u.email, { action: a.action, reason: a.reason, statement: a.statement, boardTitle, appealPath, extra });
    if (a.action.startsWith('user.')) continue; // a suspended account can't see the bell; restored: the email says it
    // No board id for adverse actions: the board may not be open to them any more (notify checks access).
    const restored = a.action === 'board.restore' || a.action === 'board.restore_link';
    await notify({
      userId,
      type: 'moderation.action',
      actorId: null,
      boardId: restored ? a.boardId : null,
      data: { boardTitle: boardTitle ?? undefined, moderationAction: a.action, appealPath: appealPath ?? undefined, excerpt: a.statement },
      dedupeKey: `moderation:${a.id}`,
    }).catch((e) => logError('moderation: could not add the notification', e));
  }
}

async function contactOf(item: repo.ItemRow): Promise<string | null> {
  if (item.reporterId) return (await getUsers([item.reporterId])).get(item.reporterId)?.email ?? null;
  return item.contactEmail;
}

async function answerReporter(item: repo.ItemRow, actioned: boolean): Promise<void> {
  const to = await contactOf(item);
  if (to) sendReportOutcome(to, { boardTitle: item.boardTitle, actioned });
}

/**
 * Closes a queue item without (another) action: 'dismissed' (nothing wrong / appeal not granted)
 * or 'actioned' (handled elsewhere). Reporters hear the outcome; an appellant whose appeal is
 * dismissed hears that the decision stands.
 */
export async function resolve(operatorId: string, itemId: string, body: Record<string, unknown>): Promise<ModerationItem> {
  const outcome = body.outcome;
  if (outcome !== 'actioned' && outcome !== 'dismissed') throw badRequest('outcome must be actioned or dismissed');
  const note = text(body.note, 'note', MAX_STATEMENT);
  const item = await repo.resolveItem(itemId, outcome, operatorId, note, Date.now());
  if (!item) throw new HttpError(409, 'This item is not open any more');
  if (item.kind === 'report') await answerReporter(item, outcome === 'actioned');
  else if (outcome === 'dismissed') {
    const to = await contactOf(item);
    if (to) sendAppealUpheld(to, { boardTitle: item.boardTitle, note });
  }
  return (await presentItems([item]))[0];
}

// ---- appeals ----

async function appealedAction(token: unknown): Promise<repo.ActionRow> {
  const id = actionIdOf(token);
  const a = id ? await repo.getAction(id) : null;
  if (!a || !appealable(a.action)) throw notFound('This appeal link is not valid');
  return a;
}

async function reversed(a: repo.ActionRow): Promise<boolean> {
  const undo = REVERSAL[a.action];
  return !!undo && (await repo.laterAction(a.targetId, [undo], a.createdAt)) !== null;
}

export async function appealInfo(token: unknown): Promise<AppealInfo> {
  const a = await appealedAction(token);
  const board = a.boardId ? await boardForModeration(a.boardId) : null;
  return {
    action: a.action,
    reason: a.reason,
    statement: a.statement,
    boardTitle: board?.title ?? null,
    createdAt: a.createdAt,
    pending: await repo.openAppealFor(a.id),
    reversed: await reversed(a),
  };
}

/** Puts an appeal into the queue (one open appeal per action). */
export async function submitAppeal(body: Record<string, unknown>): Promise<void> {
  const a = await appealedAction(body.token);
  const message = text(body.message, 'message', MAX_APPEAL);
  if (!message) throw badRequest('Tell us why you think the decision is wrong');
  if (await reversed(a)) throw new HttpError(409, 'This decision was already reversed');
  const board = a.boardId ? await boardForModeration(a.boardId) : null;
  const targetKind = a.action.startsWith('user.') ? 'user' : a.action.startsWith('upload.') ? 'upload' : 'board';
  const added = await repo.insertItem({
    id: newId(16),
    kind: 'appeal',
    boardId: a.boardId,
    boardTitle: board?.title ?? '',
    targetKind,
    targetId: a.targetId,
    reason: a.reason,
    message,
    reporterId: a.subjectUserId,
    reporterKey: null,
    contactEmail: null,
    actionId: a.id,
    createdAt: Date.now(),
    dedupeKey: `appeal:${a.id}`,
  });
  if (!added) throw new HttpError(409, 'An appeal against this decision is already waiting for review');
  log(`moderation: appeal against ${a.action} ${a.targetId}`);
  alertOperators({ kind: 'appeal', boardTitle: board?.title ?? '', reason: a.reason });
}
