// "Report a problem" (bugs, broken things, confusion) — NOT the abuse reports of moderation.
// Someone signed in sends a note, optionally a screenshot of what they saw and the diagnostics the
// app collected; only Freero's operators (OPERATOR_EMAILS, verified) read them, in /operator and
// through the operator-only API. Kept until PROBLEM_RETENTION_DAYS after the report is closed.
//
// The reporter (session cookie):
// POST /api/problems                       body CreateProblemRequest -> 201 { problem: OwnProblemReport }
// PUT  /api/problems/:id/screenshot        raw JPEG / WebP / PNG (≤ MAX_PROBLEM_SCREENSHOT_BYTES): the
//                                          report's own screenshot, once, shortly after creating it -> { problem }
// GET  /api/problems                       -> { problems: OwnProblemReport[] }  (theirs, newest first)
//
// Operators only — 404 for everyone else (session cookie here; tokens with `problems:triage` under /api/v1):
// GET   /api/operator/problems?status=&before=&limit=  -> ProblemListResponse (newest first)
// GET   /api/operator/problems/:id                     -> { problem: ProblemReportDetail }
// GET   /api/operator/problems/:id/screenshot          -> the image (private, no-store; never under /uploads)
// PATCH /api/operator/problems/:id                     body UpdateProblemRequest -> { problem }
import type { Role } from './api';

export const PROBLEM_STATUSES = ['new', 'triaged', 'fixed', 'wontfix', 'duplicate'] as const;
export type ProblemStatus = (typeof PROBLEM_STATUSES)[number];
export const isProblemStatus = (s: unknown): s is ProblemStatus => typeof s === 'string' && (PROBLEM_STATUSES as readonly string[]).includes(s);
/** A closed report is deleted PROBLEM_RETENTION_DAYS after it was closed. */
export const isClosedProblemStatus = (s: ProblemStatus) => s === 'fixed' || s === 'wontfix' || s === 'duplicate';
export const PROBLEM_STATUS_LABEL: Record<ProblemStatus, string> = {
  new: 'New',
  triaged: 'Being looked at',
  fixed: 'Fixed',
  wontfix: 'Won’t fix',
  duplicate: 'Duplicate',
};

export const MAX_PROBLEM_NOTE = 4000;
export const MAX_PROBLEM_OPERATOR_NOTE = 4000;
export const MAX_PROBLEM_ISSUE_URL = 500;
/** The screenshot as sent (the app downscales and compresses to fit well under this). */
export const MAX_PROBLEM_SCREENSHOT_BYTES = 2 * 1024 * 1024;
/** The diagnostics as sent; anything larger is refused whole (413). */
export const MAX_PROBLEM_DIAGNOSTICS_BYTES = 32 * 1024;
/** Client errors and failed requests kept in the app's ring buffer and sent with a report. */
export const MAX_PROBLEM_EVENTS = 20;
/** How long after creating a report its screenshot may still be attached. */
export const PROBLEM_SCREENSHOT_WINDOW_MS = 15 * 60_000;

export type ProblemEventKind = 'error' | 'rejection' | 'request';
/** One thing that went wrong in the app before the report: an uncaught error, a rejected promise, a failed request. */
export interface ProblemEvent {
  at: number;
  kind: ProblemEventKind;
  /** "TypeError: x is undefined", or "GET /api/boards/abc → 500" (paths only, never a query string). */
  message: string;
  /** Script and line for errors ("/assets/index-abc.js:12:40"); null otherwise. */
  source: string | null;
  /** HTTP status of a failed request (0: it never got an answer). */
  status: number | null;
}

/** What the app attaches to a report, listed in the dialog before it is sent. */
export interface ProblemDiagnostics {
  /** The page, without query string or fragment. */
  path: string;
  boardId: string | null;
  /** Their role on that board. */
  role: Role | null;
  /** FREERO_RELEASE of the server that received the report (stamped by the server). */
  release: string | null;
  userAgent: string;
  viewport: { width: number; height: number; dpr: number };
  language: string | null;
  timeZone: string | null;
  online: boolean | null;
  /** The person's clock when they sent it. */
  at: number;
  events: ProblemEvent[];
}

export interface CreateProblemRequest {
  note: string;
  /** OK to contact them about it (by email). */
  contactOk?: boolean;
  diagnostics: ProblemDiagnostics;
}

/** A report as its author sees it in their settings: what they wrote and where it stands. */
export interface OwnProblemReport {
  id: string;
  note: string;
  status: ProblemStatus;
  hasScreenshot: boolean;
  createdAt: number;
  /** When an operator last changed its status. */
  updatedAt: number;
}

/** A report as operators see it. */
export interface ProblemReportDetail extends OwnProblemReport {
  contactOk: boolean;
  diagnostics: ProblemDiagnostics;
  /** Null once their account is gone (the report goes with it, so only in a race). */
  reporter: { id: string; name: string; email: string } | null;
  operatorNote: string;
  issueUrl: string | null;
  closedAt: number | null;
  /** When the retention job deletes it (closed reports only). */
  deleteAfter: number | null;
}

export interface ProblemListResponse {
  problems: ProblemReportDetail[];
  /** Pass as `before` for the next (older) page; null at the end. */
  nextBefore: string | null;
}

export interface UpdateProblemRequest {
  status?: ProblemStatus;
  operatorNote?: string;
  /** An http(s) link to the issue it was filed as; '' or null removes it. */
  issueUrl?: string | null;
}

// ---- scrubbing: no secrets, addresses or query strings leave the browser (the server does it again) ----

const URL_QUERY = /\b((?:https?|wss?):\/\/[^\s?#"'<>]+)[?#][^\s"'<>]*/gi;
const PATH_QUERY = /((?:^|[\s"'(])\/[^\s?#"'<>]*)\?[^\s"'<>]*/g;
const FREERO_SECRET = /\bfr[a-z]_[A-Za-z0-9_-]{8,}/g;
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const KEY_VALUE = /\b(token|password|passwd|secret|api[_-]?key|session|cookie|authorization|signature)(["']?\s*[:=]\s*["']?)[^\s"'&,;]+/gi;
/** Long opaque strings (session ids, one-time links' tokens, hashes): never useful in a bug report. */
const LONG_OPAQUE = /[A-Za-z0-9_-]{32,}/g;

/** One line of text with tokens, email addresses, credentials and query strings removed, at most `max` characters. */
export function scrubProblemText(input: unknown, max = 500): string {
  if (typeof input !== 'string') return '';
  const out = input
    .replace(URL_QUERY, '$1')
    .replace(PATH_QUERY, '$1')
    .replace(FREERO_SECRET, '[token]')
    .replace(BEARER, '$1 [token]')
    .replace(JWT, '[token]')
    .replace(EMAIL, '[email]')
    .replace(KEY_VALUE, '$1$2[redacted]')
    .replace(LONG_OPAQUE, '[redacted]')
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, ' ')
    .trim();
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

const num = (v: unknown, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : 0);
const ROLES: readonly Role[] = ['owner', 'editor', 'commenter', 'viewer'];
const KINDS: readonly ProblemEventKind[] = ['error', 'rejection', 'request'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Diagnostics as they may be stored: only the known fields, each scrubbed and length-capped, at
 * most MAX_PROBLEM_EVENTS events (the newest). Used by the app before sending and by the server on
 * receipt (it never trusts the app's copy). `release` is left to the server.
 */
export function cleanProblemDiagnostics(raw: unknown): ProblemDiagnostics {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const vp = (d.viewport && typeof d.viewport === 'object' ? d.viewport : {}) as Record<string, unknown>;
  const path = scrubProblemText(typeof d.path === 'string' ? d.path.split(/[?#]/)[0] : '', 300) || '/';
  const events = (Array.isArray(d.events) ? d.events : [])
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object' && KINDS.includes((e as { kind?: unknown }).kind as ProblemEventKind))
    .slice(-MAX_PROBLEM_EVENTS)
    .map((e) => ({
      at: num(e.at, 0, 8.64e15),
      kind: e.kind as ProblemEventKind,
      message: scrubProblemText(e.message, 500) || '(no message)',
      source: typeof e.source === 'string' && e.source ? scrubProblemText(e.source, 300) : null,
      status: typeof e.status === 'number' && Number.isInteger(e.status) ? num(e.status, 0, 999) : null,
    }));
  return {
    path,
    boardId: typeof d.boardId === 'string' && ID.test(d.boardId) ? d.boardId : null,
    role: ROLES.includes(d.role as Role) ? (d.role as Role) : null,
    release: null,
    userAgent: scrubProblemText(d.userAgent, 400),
    viewport: { width: Math.round(num(vp.width, 0, 100_000)), height: Math.round(num(vp.height, 0, 100_000)), dpr: Math.round(num(vp.dpr, 0, 16) * 100) / 100 },
    language: typeof d.language === 'string' && d.language ? scrubProblemText(d.language, 40) : null,
    timeZone: typeof d.timeZone === 'string' && d.timeZone ? scrubProblemText(d.timeZone, 60) : null,
    online: typeof d.online === 'boolean' ? d.online : null,
    at: num(d.at, 0, 8.64e15),
    events,
  };
}
