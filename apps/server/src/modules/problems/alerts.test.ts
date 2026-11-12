import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { closeTestDb, mailIdle, openTestDb, outboxMails } from '../../platform/testing';
import { createUser } from '../auth/index';
import { ALERT_WINDOW_MS, alertOperatorsOfNewProblems } from './alerts';
import { createProblem, listProblems, updateProblem } from './service';

const OPS = ['first-op@alerts.test.freero.app', 'second-op@alerts.test.freero.app'];
const DAY = 24 * 3600_000;
const MIN = 60_000;

beforeAll(() => openTestDb({ OPERATOR_EMAILS: OPS.join(', ') }));
afterAll(() => closeTestDb());
afterEach(() => vi.useRealTimers());

let n = 0;
async function reporter(): Promise<string> {
  return (await createUser({ name: `Reporter ${++n}`, email: `reporter${n}@alerts.test.freero.app`, password: 'password-123' }, { emailVerified: true })).id;
}
const diagnostics = { path: '/app', userAgent: 'Mozilla/5.0 AlertTest', viewport: { width: 1280, height: 800, dpr: 2 }, at: 0, events: [] };
const file = (userId: string, note = 'The sticky jumped') => createProblem(userId, { note, diagnostics });

/** Each test starts on a later day with nothing waiting, so earlier tests' windows and reports don't count. */
let day = 0;
async function freshDay(): Promise<number> {
  const start = Date.now() + ++day * DAY;
  vi.useFakeTimers({ toFake: ['Date'], now: start });
  const waiting = await listProblems({ status: 'new', limit: '100' });
  for (const p of waiting.problems) await updateProblem('operator', p.id, { status: 'triaged' }, 'app');
  return start;
}
/** The problem alerts each operator got from `since` on. */
async function alerts(since: number) {
  await mailIdle();
  const mine = outboxMails().filter((m) => m.sentAt >= since && /new problem reports?$/.test(m.subject));
  return Object.fromEntries(OPS.map((op) => [op, mine.filter((m) => m.to === op)]));
}

it('a new problem report emails each operator once, and reports filed at the same moment or later within the window send nothing more', async () => {
  const start = await freshDay();
  const people = [await reporter(), await reporter(), await reporter()];

  await Promise.all(people.map((p) => file(p)));
  vi.setSystemTime(start + 10 * MIN);
  await file(people[0]);

  for (const op of OPS) expect((await alerts(start))[op]).toHaveLength(1);
});

it('reports filed within the window are mailed once it has passed, in one email saying how many wait, and not again without a new one', async () => {
  const start = await freshDay();
  const who = await reporter();
  await file(who);
  vi.setSystemTime(start + 5 * MIN);
  await file(who);
  await alertOperatorsOfNewProblems(start + 10 * MIN); // the job, still inside the window
  for (const op of OPS) expect((await alerts(start))[op].map((m) => m.subject)).toEqual(['1 new problem report']);

  vi.setSystemTime(start + ALERT_WINDOW_MS + MIN);
  await alertOperatorsOfNewProblems(); // the job, the window passed
  vi.setSystemTime(start + 3 * ALERT_WINDOW_MS);
  await alertOperatorsOfNewProblems(); // nothing new since

  for (const op of OPS) expect((await alerts(start))[op].map((m) => m.subject)).toEqual(['1 new problem report', '2 new problem reports']);
});

it('the operator email never contains the reporter’s note, address or diagnostics, only the link to the console', async () => {
  const start = await freshDay();
  const email = `private-person${++n}@alerts.test.freero.app`;
  const { id } = await createUser({ name: 'Private Person', email, password: 'password-123' }, { emailVerified: true });
  await createProblem(id, { note: 'My secret project codename is Bluebird', diagnostics: { ...diagnostics, path: '/board/secret-board-id' } });

  const [mail] = (await alerts(start))[OPS[0]];
  const everything = JSON.stringify(mail);
  for (const leak of ['Bluebird', email, 'Private Person', 'AlertTest', 'secret-board-id']) expect(everything).not.toContain(leak);
  expect(mail.text).toContain('/operator?view=problems');
});
