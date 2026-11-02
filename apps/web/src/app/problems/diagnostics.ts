// What "Report a problem" attaches besides the note and screenshot: where the person was, their
// browser and window, and the last things that went wrong in this tab — uncaught errors, rejected
// promises and failed requests to Freero's server — from a small ring buffer installed once by the
// app shell. Everything is scrubbed (no query strings, tokens or email addresses) before it is
// kept, again before it is sent, and once more by the server.
import {
  cleanProblemDiagnostics,
  MAX_PROBLEM_EVENTS,
  scrubProblemText,
  type ProblemDiagnostics,
  type ProblemEvent,
  type Role,
} from '@freero/shared';

const events: ProblemEvent[] = [];
let installed = false;

/** Requests that never belong in a report: sending one (a report failing is not "what went wrong" before it). */
const IGNORED_PATHS = /^\/api\/problems(\/|$)/;

function push(e: Omit<ProblemEvent, 'at'>): void {
  events.push({ ...e, at: Date.now(), message: scrubProblemText(e.message), source: e.source ? scrubProblemText(e.source, 300) : null });
  if (events.length > MAX_PROBLEM_EVENTS) events.splice(0, events.length - MAX_PROBLEM_EVENTS);
}

const describe = (v: unknown): string => {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

/** A request to this origin as "METHOD /path" (no query string, no other origin's address). */
function requestLabel(input: RequestInfo | URL, init?: RequestInit): { label: string; path: string } | null {
  try {
    const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url, window.location.href);
    if (url.origin !== window.location.origin) return null;
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    return { label: `${method} ${url.pathname}`, path: url.pathname };
  } catch {
    return null;
  }
}

/** Installs the collector (once per tab): errors, rejections and failed same-origin fetches. */
export function installProblemCollector(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (e) => {
    // A resource that failed to load (an <img>) fires 'error' without an ErrorEvent message.
    if (!(e instanceof ErrorEvent)) return;
    push({ kind: 'error', message: e.error ? describe(e.error) : e.message || 'Script error', source: e.filename ? `${e.filename}:${e.lineno}:${e.colno}` : null, status: null });
  });
  window.addEventListener('unhandledrejection', (e) => push({ kind: 'rejection', message: describe(e.reason), source: null, status: null }));
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = requestLabel(input, init);
    try {
      const res = await original(input, init);
      if (req && res.status >= 400 && !IGNORED_PATHS.test(req.path)) push({ kind: 'request', message: `${req.label} → ${res.status}`, source: null, status: res.status });
      return res;
    } catch (err) {
      const aborted = err instanceof DOMException && err.name === 'AbortError';
      if (req && !aborted && !IGNORED_PATHS.test(req.path)) push({ kind: 'request', message: `${req.label} → no answer (${describe(err)})`, source: null, status: 0 });
      throw err;
    }
  };
}

/** Where the person is and what this tab saw, as the dialog lists it and the server will get it. */
export function collectDiagnostics(board: { id: string; role: Role } | null): ProblemDiagnostics {
  let timeZone: string | null = null;
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    // no Intl time zones
  }
  return cleanProblemDiagnostics({
    path: window.location.pathname,
    boardId: board?.id ?? null,
    role: board?.role ?? null,
    userAgent: navigator.userAgent,
    viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio || 1 },
    language: navigator.language ?? null,
    timeZone,
    online: typeof navigator.onLine === 'boolean' ? navigator.onLine : null,
    at: Date.now(),
    events: events.slice(),
  });
}
