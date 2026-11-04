// Retention of inactive boards (#154): a workspace's rule (its own, raised to its organisation's
// floor; workspaces' `inactiveBoardRules`) archives or trashes boards nobody opened or changed for
// its period. Owners are emailed RETENTION_NOTICE_DAYS before; any activity (an edit, a rename,
// someone opening it, unarchiving) makes the notice stale, so the clock starts again and a fresh
// notice must go out first. Never touched: archived boards (archiving is how a board is kept),
// boards taken down by an operator, boards a hold check names (legal holds, #157:
// `onBoardRetentionHold`), and every board of a workspace under a hold (`workspaceHoldOn`).
// Each board is checked again in the statement that changes it (repo `applyInactiveRule`): only
// that workspace's, still inactive, still noticed — so the job is idempotent and can't race an open.
import { RETENTION_NOTICE_DAYS } from '@freero/shared';
import { logError } from '../../platform/log';
import { appUrl, renderMail, sendMailLater } from '../../platform/mail';
import { recordAudit } from '../audit/index';
import { getUsers } from '../auth/index';
import { refreshBoardAccess } from '../realtime/index';
import { inactiveBoardRules, workspaceHoldOn } from '../workspaces/index';
import * as repo from './repo';
import { boardTarget, closeKeepingContent } from './service';

const DAY_MS = 86_400_000;
const BATCH = 200;

/** Advisory lock key of the retention job (platform/jobs). */
export const RETENTION_LOCK_KEY = 7_202_611_271; // arbitrary, constant across releases

/** Returns the ids among `boardIds` that must be kept as they are (a legal hold), whatever a rule says. */
export type BoardHoldCheck = (boardIds: string[]) => Promise<Set<string>> | Set<string>;
const holdChecks = new Set<BoardHoldCheck>();

/** A module that must keep boards (legal holds, #157) registers here; a rule then skips them. */
export function onBoardRetentionHold(fn: BoardHoldCheck): () => void {
  holdChecks.add(fn);
  return () => holdChecks.delete(fn);
}

/** The held ones among `ids`. A failing check holds them all (fail closed: nothing is removed on a guess). */
async function heldAmong(ids: string[]): Promise<Set<string>> {
  const held = new Set<string>();
  if (!ids.length) return held;
  try {
    for (const id of await repo.heldAmong(ids)) held.add(id); // legal holds (#157), kept in this module
  } catch (e) {
    logError('boards: the legal hold check failed; keeping these boards', e);
    return new Set(ids);
  }
  for (const fn of holdChecks) {
    try {
      for (const id of await fn(ids)) held.add(id);
    } catch (e) {
      logError('boards: a retention hold check failed; keeping these boards', e);
      return new Set(ids);
    }
  }
  return held;
}

export interface RetentionRound {
  noticed: number;
  archived: number;
  trashed: number;
}

/** One round over every workspace with a rule; the caller holds RETENTION_LOCK_KEY (the job). */
export async function applyRetentionLocked(now = Date.now()): Promise<RetentionRound> {
  const round: RetentionRound = { noticed: 0, archived: 0, trashed: 0 };
  for (const rule of await inactiveBoardRules()) {
    try {
      if (await workspaceHoldOn(rule.workspaceId)) continue;
      await applyRule(rule, now, round);
    } catch (e) {
      logError(`boards: retention of workspace ${rule.workspaceId} failed this round`, e);
    }
  }
  return round;
}

async function applyRule(rule: { workspaceId: string; name: string; action: 'archive' | 'trash'; days: number }, now: number, round: RetentionRound): Promise<void> {
  const cutoff = now - rule.days * DAY_MS; // inactive since before this: the rule applies
  const warnFrom = cutoff + RETENTION_NOTICE_DAYS * DAY_MS; // inactive since before this: time to warn
  const noticedBy = now - RETENTION_NOTICE_DAYS * DAY_MS; // a notice must be at least this old
  for (let page: repo.InactiveBoard | null = null; ; ) {
    const rows = await repo.inactiveBoardsIn(rule.workspaceId, warnFrom, BATCH, page);
    const held = await heldAmong(rows.map((r) => r.id));
    const toWarn: repo.InactiveBoard[] = [];
    for (const b of rows) {
      if (held.has(b.id)) continue;
      const warned = b.noticeAt !== null && b.noticeAt > b.lastActivityAt;
      if (!warned) toWarn.push(b);
      else if (b.lastActivityAt <= cutoff && b.noticeAt! <= noticedBy) await apply(rule, b, cutoff, noticedBy, now, round);
    }
    await warnOwners(rule, toWarn, warnFrom, now, round);
    if (rows.length < BATCH) return;
    page = rows[rows.length - 1];
  }
}

async function apply(rule: { workspaceId: string; action: 'archive' | 'trash'; days: number }, b: repo.InactiveBoard, cutoff: number, noticedBy: number, now: number, round: RetentionRound) {
  const target = boardTarget(b);
  const metadata = { reason: 'retention', inactiveDays: rule.days, owner: b.ownerId, lastActivity: new Date(b.lastActivityAt).toISOString() };
  const done = await repo.transaction(async () => {
    if (!(await repo.applyInactiveRule(rule.workspaceId, b.id, rule.action, cutoff, noticedBy, now))) return false;
    await recordAudit({ action: rule.action === 'archive' ? 'board.archived' : 'board.trashed', workspaceId: rule.workspaceId, actorId: null, target, metadata });
    if (rule.action === 'trash') await repo.appendBoardEvent({ type: 'board.trashed', boardId: b.id, workspaceId: rule.workspaceId, actorId: null, title: b.title }, now);
    return true;
  });
  if (!done) return;
  if (rule.action === 'archive') {
    round.archived++;
    await refreshBoardAccess(b.id); // read-only from now on, for everyone connected
  } else {
    round.trashed++;
    await closeKeepingContent(b.id, 'deleted');
  }
}

/** One email per owner listing their boards the rule applies to soon; each board is noticed once (until it is used again). */
async function warnOwners(rule: { workspaceId: string; name: string; action: 'archive' | 'trash'; days: number }, boards: repo.InactiveBoard[], warnFrom: number, now: number, round: RetentionRound) {
  if (!boards.length) return;
  const marked = new Set(await repo.markRetentionNoticed(rule.workspaceId, boards.map((b) => b.id), warnFrom, now));
  const noticed = boards.filter((b) => marked.has(b.id));
  if (!noticed.length) return;
  for (const b of noticed)
    await recordAudit({
      action: 'board.retention_notice',
      workspaceId: rule.workspaceId,
      actorId: null,
      target: boardTarget(b),
      metadata: { owner: b.ownerId, rule: rule.action, inactiveDays: rule.days, due: new Date(dueAt(b, rule.days, now)).toISOString() },
    });
  round.noticed += noticed.length;
  const owners = await getUsers([...new Set(noticed.map((b) => b.ownerId))]);
  for (const [ownerId, owner] of owners) {
    const theirs = noticed.filter((b) => b.ownerId === ownerId);
    const what = rule.action === 'archive' ? 'archived (kept, read-only)' : 'moved to the trash';
    sendMailLater({
      to: owner.email,
      ...renderMail({
        subject: `${theirs.length === 1 ? `“${theirs[0].title || 'Untitled board'}” will be` : `${theirs.length} of your boards will be`} ${rule.action === 'archive' ? 'archived' : 'moved to the trash'}`,
        title: `Boards nobody has used for a while`,
        paragraphs: [
          `${rule.name} ${rule.action === 'archive' ? 'archives' : 'moves to the trash'} boards that nobody has opened or changed for ${rule.days} days. In ${RETENTION_NOTICE_DAYS} days, these boards of yours will be ${what}:`,
          ...theirs.map((b) => `• ${b.title || 'Untitled board'} — last used ${new Date(b.lastActivityAt).toUTCString().slice(0, 16)}`),
          'To keep one as it is, open it before then: any activity starts the clock again.',
        ],
        action: { label: 'Open Freero', url: appUrl(null, `/app?ws=${encodeURIComponent(rule.workspaceId)}`) },
      }),
    });
  }
}

const dueAt = (b: repo.InactiveBoard, days: number, now: number) => Math.max(b.lastActivityAt + days * DAY_MS, now + RETENTION_NOTICE_DAYS * DAY_MS);
