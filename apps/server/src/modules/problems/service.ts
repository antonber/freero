// "Report a problem" (bugs, broken things, confusion): what a signed-in person sends, what
// operators read and decide, how long it is kept. Not abuse reports — those are modules/moderation.
//
// Who sees what: the reporter lists their own reports (note, status); operators (auth's
// isOperator: OPERATOR_EMAILS, verified) read everything — the screenshot, the diagnostics and the
// reporter's address — through the operator routes or a `problems:triage` token (modules/api).
// Everyone else gets the same 404 as for an id that doesn't exist.
import type { Readable } from 'node:stream';
import {
  cleanProblemDiagnostics,
  isClosedProblemStatus,
  isProblemStatus,
  MAX_PROBLEM_DIAGNOSTICS_BYTES,
  MAX_PROBLEM_ISSUE_URL,
  MAX_PROBLEM_NOTE,
  MAX_PROBLEM_OPERATOR_NOTE,
  MAX_PROBLEM_SCREENSHOT_BYTES,
  PROBLEM_SCREENSHOT_WINDOW_MS,
  type OwnProblemReport,
  type ProblemListResponse,
  type ProblemReportDetail,
  type ProblemStatus,
} from '@freero/shared';
import { audit } from '../../platform/audit';
import { getConfig } from '../../platform/config';
import { badRequest, HttpError, notFound } from '../../platform/http';
import { newId } from '../../platform/ids';
import { logError } from '../../platform/log';
import { getUsers } from '../auth/index';
import { notify } from '../notifications/index';
import { deletePrivateImage, openPrivateImage, savePrivateImage } from '../uploads/index';
import * as repo from './repo';

const MAX_OWN_LISTED = 100;
const MAX_PAGE = 100;
const DEFAULT_PAGE = 50;
const RETENTION_BATCH = 200;

const noSuchReport = () => notFound('No such problem report');
const tooLarge = (what: string, max: number) => new HttpError(413, `${what} is too large (max ${Math.round(max / 1024)} KB)`);

const own = (r: repo.ProblemRow): OwnProblemReport => ({
  id: r.id,
  note: r.note,
  status: r.status,
  hasScreenshot: r.screenshotKey !== null,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

async function details(rows: repo.ProblemRow[]): Promise<ProblemReportDetail[]> {
  const users = await getUsers(rows.map((r) => r.userId));
  const keep = getConfig().problemRetentionMs;
  return rows.map((r) => {
    const u = users.get(r.userId);
    return {
      ...own(r),
      contactOk: r.contactOk,
      diagnostics: r.diagnostics,
      reporter: u ? { id: u.id, name: u.name, email: u.email } : null,
      operatorNote: r.operatorNote,
      issueUrl: r.issueUrl,
      closedAt: r.closedAt,
      deleteAfter: r.closedAt === null ? null : r.closedAt + keep,
    };
  });
}

// ---- the reporter ----

/** Files a report (the route checked the session and the per-person rate limit). */
export async function createProblem(userId: string, body: Record<string, unknown>): Promise<OwnProblemReport> {
  const note = typeof body.note === 'string' ? body.note.trim() : '';
  if (!note) throw badRequest('Say what went wrong');
  if (note.length > MAX_PROBLEM_NOTE) throw badRequest(`The note is too long (max ${MAX_PROBLEM_NOTE} characters)`);
  if (body.contactOk !== undefined && typeof body.contactOk !== 'boolean') throw badRequest('contactOk must be true or false');
  if (!body.diagnostics || typeof body.diagnostics !== 'object' || Array.isArray(body.diagnostics)) throw badRequest('Send the diagnostics');
  if (Buffer.byteLength(JSON.stringify(body.diagnostics)) > MAX_PROBLEM_DIAGNOSTICS_BYTES) throw tooLarge('The diagnostics', MAX_PROBLEM_DIAGNOSTICS_BYTES);
  // Never the app's copy as sent: only known fields, scrubbed again here, and this server's release.
  const diagnostics = { ...cleanProblemDiagnostics(body.diagnostics), release: getConfig().release };
  const row = await repo.insert({ id: newId(16), userId, note, contactOk: body.contactOk === true, diagnostics, createdAt: Date.now() });
  return own(row);
}

/**
 * The screenshot of the reporter's own, just-made report (raw image bytes). Refused (404) for
 * someone else's report, one that already has a screenshot or one older than the window; 413 over
 * the cap; 415 when the bytes are not a PNG, JPEG or WebP.
 */
export async function attachScreenshot(userId: string, id: string, data: Uint8Array): Promise<OwnProblemReport> {
  if (data.byteLength > MAX_PROBLEM_SCREENSHOT_BYTES) throw tooLarge('The screenshot', MAX_PROBLEM_SCREENSHOT_BYTES);
  const row = await repo.get(id);
  const madeAfter = Date.now() - PROBLEM_SCREENSHOT_WINDOW_MS;
  if (!row || row.userId !== userId || row.screenshotKey !== null || row.createdAt <= madeAfter) throw noSuchReport();
  const saved = await savePrivateImage(data);
  if (!saved) throw new HttpError(415, 'The screenshot must be a PNG, JPEG or WebP image');
  if (!(await repo.attachScreenshot(id, userId, saved.key, madeAfter))) {
    await deletePrivateImage(saved.key); // attached concurrently, or the report went meanwhile
    throw noSuchReport();
  }
  return own((await repo.get(id))!);
}

export async function ownProblems(userId: string): Promise<OwnProblemReport[]> {
  return (await repo.ofUser(userId, MAX_OWN_LISTED)).map(own);
}

// ---- operators (the routes and modules/api checked isOperator first) ----

const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

export async function listProblems(q: { status?: unknown; before?: unknown; limit?: unknown }): Promise<ProblemListResponse> {
  const status = str(q.status);
  if (status !== null && !isProblemStatus(status)) throw badRequest('status must be one of new, triaged, fixed, wontfix, duplicate');
  const n = q.limit === undefined || q.limit === '' ? DEFAULT_PAGE : Number(q.limit);
  if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE) throw badRequest(`limit must be a whole number from 1 to ${MAX_PAGE}`);
  const rows = await repo.list({ status, before: str(q.before), limit: n + 1 });
  const page = rows.slice(0, n);
  return { problems: await details(page), nextBefore: rows.length > n ? page[page.length - 1].id : null };
}

export async function problemDetail(id: string): Promise<ProblemReportDetail> {
  const row = await repo.get(id);
  if (!row) throw noSuchReport();
  return (await details([row]))[0];
}

/** The screenshot, for an operator; audited like reviewing a reported file. */
export async function problemScreenshot(operatorId: string, id: string, via: 'app' | 'api'): Promise<{ body: Readable; size: number | null; contentType: string }> {
  const row = await repo.get(id);
  const file = row?.screenshotKey ? await openPrivateImage(row.screenshotKey) : null;
  if (!row || !file) throw notFound('This report has no screenshot');
  await audit({ action: 'problems.screenshot_viewed', actor: { kind: 'user', userId: operatorId }, userId: row.userId, detail: { problemId: id, via } });
  return file;
}

function cleanIssueUrl(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (typeof v !== 'string' || v.length > MAX_PROBLEM_ISSUE_URL) throw badRequest(`issueUrl must be a link of at most ${MAX_PROBLEM_ISSUE_URL} characters`);
  let u: URL;
  try {
    u = new URL(v.trim());
  } catch {
    throw badRequest('issueUrl must be an http(s) link');
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw badRequest('issueUrl must be an http(s) link');
  return u.toString();
}

/**
 * An operator sets the status, their note or the linked issue. Moving a report to `fixed`
 * tells the reporter in their inbox (once per report).
 */
export async function updateProblem(operatorId: string, id: string, body: Record<string, unknown>, via: 'app' | 'api'): Promise<ProblemReportDetail> {
  const patch: { status?: ProblemStatus; operatorNote?: string; issueUrl?: string | null } = {};
  if (body.status !== undefined) {
    if (!isProblemStatus(body.status)) throw badRequest('status must be one of new, triaged, fixed, wontfix, duplicate');
    patch.status = body.status;
  }
  if (body.operatorNote !== undefined) {
    if (typeof body.operatorNote !== 'string') throw badRequest('operatorNote must be text');
    if (body.operatorNote.length > MAX_PROBLEM_OPERATOR_NOTE) throw badRequest(`operatorNote is too long (max ${MAX_PROBLEM_OPERATOR_NOTE} characters)`);
    patch.operatorNote = body.operatorNote.trim();
  }
  const issueUrl = cleanIssueUrl(body.issueUrl);
  if (issueUrl !== undefined) patch.issueUrl = issueUrl;
  if (!Object.keys(patch).length) throw badRequest('Send status, operatorNote or issueUrl');
  const changed = await repo.update(id, patch, isClosedProblemStatus, Date.now());
  if (!changed) throw noSuchReport();
  const { before, after } = changed;
  await audit({
    action: 'problems.updated',
    actor: { kind: 'user', userId: operatorId },
    userId: after.userId,
    detail: { problemId: id, via, ...(before.status !== after.status ? { from: before.status, to: after.status } : {}) },
  });
  if (after.status === 'fixed' && before.status !== 'fixed')
    await notify({
      userId: after.userId,
      type: 'problem.fixed',
      actorId: null,
      boardId: null,
      data: { excerpt: after.note.replace(/\s+/g, ' ').slice(0, 140) },
      dedupeKey: `problem.fixed:${id}`,
    }).catch((e) => logError('problems: could not add the notification', e));
  return (await details([after]))[0];
}

// ---- retention, accounts ----

/** Deletes closed reports (screenshot first) closed longer ago than PROBLEM_RETENTION_DAYS. Returns how many. */
export async function purgeClosedProblems(now = Date.now()): Promise<number> {
  const due = now - getConfig().problemRetentionMs;
  let deleted = 0;
  for (;;) {
    const batch = await repo.closedBefore(due, RETENTION_BATCH);
    for (const r of batch) {
      if (!(await repo.deleteIfStillDue(r.id, due))) continue; // reopened meanwhile
      await deletePrivateImage(r.screenshotKey).catch((e) => logError(`problems: could not delete the screenshot of ${r.id}`, e));
      deleted++;
    }
    if (batch.length < RETENTION_BATCH) return deleted;
  }
}

/** The account purge: every report of the person and their screenshots. */
export async function deleteProblemsOf(userId: string): Promise<number> {
  const keys = await repo.deleteOfUser(userId);
  for (const key of keys) await deletePrivateImage(key);
  return keys.length;
}

/**
 * For the person's data export: their reports (what they sent and where it stands; operators'
 * internal notes stay out) and, per report, a way to read its screenshot's bytes.
 */
export async function problemsExportOf(userId: string): Promise<Array<{ report: Record<string, unknown>; screenshot: { name: string; read: () => Promise<Buffer | null> } | null }>> {
  const rows = await repo.ofUser(userId, 100_000);
  return rows.map((r) => ({
    report: {
      id: r.id,
      note: r.note,
      contactOk: r.contactOk,
      status: r.status,
      diagnostics: r.diagnostics,
      screenshot: r.screenshotKey ? `problems/${r.id}.${r.screenshotKey.split('.').pop()}` : null,
      createdAt: new Date(r.createdAt).toISOString(),
      closedAt: r.closedAt === null ? null : new Date(r.closedAt).toISOString(),
    },
    screenshot: r.screenshotKey ? { name: `${r.id}.${r.screenshotKey.split('.').pop()}`, read: () => readStream(r.screenshotKey!) } : null,
  }));
}

async function readStream(key: string): Promise<Buffer | null> {
  const file = await openPrivateImage(key);
  if (!file) return null;
  const chunks: Buffer[] = [];
  for await (const c of file.body) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c as Uint8Array));
  return Buffer.concat(chunks);
}
