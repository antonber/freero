import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { MAX_PROBLEM_DIAGNOSTICS_BYTES, MAX_PROBLEM_SCREENSHOT_BYTES } from '@freero/shared';
import { getConfig } from '../../platform/config';
import { apiNotFound, createApp, errorHandler } from '../../platform/http';
import { initStorage } from '../../platform/storage';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { purgeDueAccounts } from '../accounts/index';
import { completeSignIn, createUser, scheduleAccountDeletion } from '../auth/index';
import { notificationsExportOf } from '../notifications/index';
import { openPrivateImage, uploadName } from '../uploads/index';
import * as repo from './repo';
import problemRoutes from './routes';
import { createProblem, problemDetail, purgeClosedProblems, updateProblem } from './service';

// The storage refusing the next screenshot deletes (an outage, a permission error).
let failDeletes = 0;
vi.mock('../uploads/index', async (importOriginal) => {
  const real = await importOriginal<typeof import('../uploads/index')>();
  return {
    ...real,
    deletePrivateImage: async (key: string | null | undefined) => {
      if (failDeletes > 0) {
        failDeletes--;
        throw new Error('storage unavailable');
      }
      return real.deletePrivateImage(key);
    },
  };
});

const OPERATOR = 'op@problems.test.freero.app';
const UNPROVEN = 'unproven@problems.test.freero.app';
let server: http.Server;
let base = '';
let dir = '';

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-problems-'));
  const config = await openTestDb({ FREERO_DATA_DIR: dir, OPERATOR_EMAILS: `${OPERATOR}, ${UNPROVEN}` });
  initStorage(config);
  const app = createApp(config);
  // A real session for a test account: how every sign-in ends (auth's completeSignIn).
  app.post('/test/sign-in/:userId', (req, res, next) => void completeSignIn(req, res, req.params.userId, 'password').then((r) => res.json(r), next));
  app.use('/api', problemRoutes({ config, onShutdown: () => undefined }));
  app.use('/api', apiNotFound());
  app.use(errorHandler());
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise((r) => server.close(r));
  await closeTestDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

interface Person {
  id: string;
  cookie: string;
}
let n = 0;
/** An account (verified unless said otherwise) with a real session cookie. */
async function person(email = `person${++n}@problems.test.freero.app`, verified = true): Promise<Person> {
  const { id } = await createUser({ name: email.split('@')[0], email, password: 'password-123' }, { emailVerified: verified });
  return signedIn(id);
}
let operatorId: string | null = null;
/** A session of the operator (OPERATOR_EMAILS, verified). */
async function operator(): Promise<Person> {
  if (operatorId) return signedIn(operatorId);
  const p = await person(OPERATOR);
  operatorId = p.id;
  return p;
}
/** A new session of the account. */
async function signedIn(id: string): Promise<Person> {
  const res = await fetch(`${base}/test/sign-in/${id}`, { method: 'POST', headers: { origin: base } });
  expect(res.status, await res.clone().text()).toBe(200);
  return { id, cookie: res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ') };
}

const send = (p: string, init: { method?: string; cookie?: string; json?: unknown; body?: Uint8Array } = {}) =>
  fetch(base + p, {
    method: init.method ?? 'GET',
    headers: {
      origin: base,
      ...(init.cookie ? { cookie: init.cookie } : {}),
      ...(init.json !== undefined ? { 'content-type': 'application/json' } : init.body ? { 'content-type': 'image/jpeg' } : {}),
    },
    body: init.json !== undefined ? JSON.stringify(init.json) : (init.body as BodyInit | undefined),
  });

const jpeg = (bytes = 2048) => {
  const b = new Uint8Array(bytes);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};
const diagnostics = (extra: Record<string, unknown> = {}) => ({ path: '/app', userAgent: 'Mozilla/5.0 Test', viewport: { width: 1280, height: 800, dpr: 2 }, at: Date.now(), events: [], ...extra });

/** A report with a screenshot, sent through the reporter's routes. */
async function reportWithScreenshot(by: Person): Promise<string> {
  const made = await send('/api/problems', { method: 'POST', cookie: by.cookie, json: { note: 'The sticky jumped', diagnostics: diagnostics() } });
  expect(made.status).toBe(201);
  const { problem } = (await made.json()) as { problem: { id: string } };
  expect((await send(`/api/problems/${problem.id}/screenshot`, { method: 'PUT', cookie: by.cookie, body: jpeg() })).status).toBe(200);
  return problem.id;
}

it('only operators read or change problem reports: everyone else — the reporter, an unproven operator address — gets 404', async () => {
  const reporter = await person();
  const op = await operator();
  const unproven = await person(UNPROVEN, false);
  const id = await reportWithScreenshot(reporter);
  const paths = ['/api/operator/problems', `/api/operator/problems/${id}`, `/api/operator/problems/${id}/screenshot`];

  for (const who of [reporter, unproven]) {
    for (const p of paths) expect((await send(p, { cookie: who.cookie })).status, p).toBe(404);
    expect((await send(`/api/operator/problems/${id}`, { method: 'PATCH', cookie: who.cookie, json: { status: 'wontfix' } })).status).toBe(404);
  }
  expect((await problemDetail(id)).status).toBe('new');
  const listed = (await (await send('/api/operator/problems?status=new', { cookie: op.cookie })).json()) as { problems: Array<{ id: string; reporter: { email: string } }> };
  expect(listed.problems.find((p) => p.id === id)?.reporter.email).toMatch(/^person\d+@/);
});

it('a screenshot is private: never an upload name (so never served under /uploads), shown only to operators and never cached; nobody attaches one to someone else’s report, nor a second one', async () => {
  const reporter = await person();
  const other = await person();
  const lookalike = await person(OPERATOR.replace('op@', 'op.lookalike@'));
  const id = await reportWithScreenshot(reporter);
  const key = (await repo.get(id))!.screenshotKey!;
  expect(uploadName(key)).toBeNull();

  // Not listed in OPERATOR_EMAILS: just another account.
  expect((await send(`/api/operator/problems/${id}/screenshot`, { cookie: lookalike.cookie })).status).toBe(404);
  const shown = await send(`/api/operator/problems/${id}/screenshot`, { cookie: (await operator()).cookie });
  expect(shown.status).toBe(200);
  expect(shown.headers.get('content-type')).toBe('image/jpeg');
  expect(shown.headers.get('cache-control')).toContain('no-store');
  expect((await shown.arrayBuffer()).byteLength).toBe(jpeg().byteLength);

  expect((await send(`/api/problems/${id}/screenshot`, { method: 'PUT', cookie: other.cookie, body: jpeg() })).status).toBe(404);
  expect((await send(`/api/problems/${id}/screenshot`, { method: 'PUT', cookie: reporter.cookie, body: jpeg() })).status).toBe(404);
  expect((await repo.get(id))!.screenshotKey).toBe(key);
});

it('a report over the size caps is refused whole: a screenshot over its cap is not stored, diagnostics over theirs make no report', async () => {
  const reporter = await person();
  const made = await send('/api/problems', { method: 'POST', cookie: reporter.cookie, json: { note: 'Big', diagnostics: diagnostics() } });
  const { problem } = (await made.json()) as { problem: { id: string } };
  const huge = await send(`/api/problems/${problem.id}/screenshot`, { method: 'PUT', cookie: reporter.cookie, body: jpeg(MAX_PROBLEM_SCREENSHOT_BYTES + 1) });
  expect(huge.status).toBe(413);
  expect((await repo.get(problem.id))!.screenshotKey).toBeNull();

  const before = (await repo.ofUser(reporter.id, 100)).length;
  const events = Array.from({ length: 400 }, (_, i) => ({ at: i, kind: 'error', message: 'x'.repeat(200), source: null, status: null }));
  expect(JSON.stringify(events).length).toBeGreaterThan(MAX_PROBLEM_DIAGNOSTICS_BYTES);
  const tooMuch = await send('/api/problems', { method: 'POST', cookie: reporter.cookie, json: { note: 'Big', diagnostics: diagnostics({ events }) } });
  expect(tooMuch.status).toBe(413);
  expect(await repo.ofUser(reporter.id, 100)).toHaveLength(before);
});

it('tokens, email addresses and query strings in the diagnostics never reach the database, whatever the app sent', async () => {
  const reporter = await person();
  const secret = 'frp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789abcd';
  const { id } = await createProblem(reporter.id, {
    note: 'Saving fails',
    diagnostics: diagnostics({
      path: `/invite/${'k'.repeat(43)}?token=abc#x`,
      events: [
        { at: 1, kind: 'request', message: 'POST /api/boards/b1/members?email=ann@example.com → 500', source: null, status: 500 },
        { at: 2, kind: 'error', message: `Error: Authorization: Bearer ${secret} rejected for bob@example.org`, source: 'https://freero.app/assets/x.js?v=1&session=zzz:1:2', status: null },
        { at: 3, kind: 'rejection', message: `fetch https://freero.app/reset-password?t=${'q'.repeat(40)} failed: password=hunter2`, source: null, status: null },
      ],
    }),
  });
  const stored = JSON.stringify((await repo.get(id))!.diagnostics);
  for (const leak of [secret, 'ann@example.com', 'bob@example.org', 'token=abc', 'session=zzz', 'k'.repeat(43), 'q'.repeat(40), 'hunter2', '?'])
    expect(stored, `stored diagnostics contain ${leak}`).not.toContain(leak);
  // What helps triage stays: the request, its status, the error's script.
  expect(stored).toContain('POST /api/boards/b1/members');
  expect(stored).toContain('https://freero.app/assets/x.js');
});

it('deleting an account deletes its problem reports and their screenshots', async () => {
  const leaving = await person();
  const id = await reportWithScreenshot(leaving);
  const key = (await repo.get(id))!.screenshotKey!;
  await scheduleAccountDeletion(null, leaving.id, 'password-123');
  await purgeDueAccounts(Date.now() + getConfig().accountDeletionGraceMs + 60_000);
  expect(await repo.get(id)).toBeNull();
  expect(await openPrivateImage(key)).toBeNull();
});

it('a closed report is deleted with its screenshot once the retention period after closing has passed; reopening it stops the clock', async () => {
  const reporter = await person();
  const closed = await reportWithScreenshot(reporter);
  const reopened = await reportWithScreenshot(reporter);
  const open = await reportWithScreenshot(reporter);
  await updateProblem('operator', closed, { status: 'fixed' }, 'app');
  await updateProblem('operator', reopened, { status: 'duplicate' }, 'app');
  await updateProblem('operator', reopened, { status: 'triaged' }, 'app');
  const key = (await repo.get(closed))!.screenshotKey!;

  expect(await purgeClosedProblems(Date.now())).toBe(0);
  await purgeClosedProblems(Date.now() + getConfig().problemRetentionMs + 60_000);
  expect(await repo.get(closed)).toBeNull();
  expect(await openPrivateImage(key)).toBeNull();
  expect(await repo.get(reopened)).not.toBeNull();
  expect(await repo.get(open)).not.toBeNull();
});

it('a screenshot whose file delete fails is still deleted by the next retention run, whether its report went with the account or with the retention period', async () => {
  const leaving = await person();
  const leavingKeys: string[] = [];
  for (let i = 0; i < 2; i++) leavingKeys.push((await repo.get(await reportWithScreenshot(leaving)))!.screenshotKey!);
  const staying = await person();
  const closed = await reportWithScreenshot(staying);
  const closedKey = (await repo.get(closed))!.screenshotKey!;
  await updateProblem('operator', closed, { status: 'wontfix' }, 'app');

  // The storage fails on the first screenshot of the account, then on the closed report's.
  failDeletes = 1;
  await scheduleAccountDeletion(null, leaving.id, 'password-123');
  await purgeDueAccounts(Date.now() + getConfig().accountDeletionGraceMs + 60_000);
  failDeletes = 1;
  await purgeClosedProblems(Date.now() + getConfig().problemRetentionMs + 60_000);
  expect(await repo.get(closed)).toBeNull();
  expect(await repo.ofUser(leaving.id, 10)).toEqual([]);

  // The storage works again: the next run finishes the job.
  await purgeClosedProblems(Date.now());
  for (const key of [...leavingKeys, closedKey]) expect(await openPrivateImage(key), key).toBeNull();
});

it('marking a report fixed tells its reporter once, even when it is reopened and fixed again', async () => {
  const reporter = await person();
  const { id } = await createProblem(reporter.id, { note: 'Export button does nothing', diagnostics: diagnostics() });
  for (const status of ['triaged', 'fixed', 'new', 'fixed'] as const) await updateProblem('operator', id, { status }, 'api');
  const fixed = (await notificationsExportOf(reporter.id)).notifications.filter((x) => (x as { type: string }).type === 'problem.fixed');
  expect(fixed).toHaveLength(1);
});
