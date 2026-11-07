// The exclusive-job scheduler's lifecycle: a run in flight survives a shutdown, and two jobs can't
// share one advisory lock (each would silently skip the other's runs).
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ServerContext } from './context';
import { scheduleExclusiveJob } from './jobs';
import { consumeOutbox } from './outbox';
import { closeTestDb, openTestDb } from './testing';

beforeAll(async () => {
  await openTestDb();
});
afterAll(() => closeTestDb());

function fakeContext() {
  const hooks: Array<() => void | Promise<void>> = [];
  const ctx = { onShutdown: (fn: () => void | Promise<void>) => void hooks.push(fn) } as unknown as ServerContext;
  return { ctx, shutdown: async () => { for (const h of [...hooks].reverse()) await h(); } };
}

it('a shutdown during a job run longer than its interval waits for that run before the database closes', async () => {
  const { ctx, shutdown } = fakeContext();
  let finished = false;
  scheduleExclusiveJob(ctx, {
    name: 'test:long',
    lockKey: 7_299_999_001,
    intervalMs: 20,
    firstRunMs: 0,
    // A delivery run waiting on a slow receiver: longer than its interval.
    run: () => new Promise<void>((res) => setTimeout(() => ((finished = true), res()), 300)),
  });
  await new Promise((res) => setTimeout(res, 100)); // several ticks found the run still going
  await shutdown();
  expect(finished).toBe(true);
});

it('a job or consumer given a lock key another one already uses fails as it is registered, naming both', () => {
  const { ctx, shutdown } = fakeContext();
  scheduleExclusiveJob(ctx, { name: 'test:first', lockKey: 7_299_999_002, intervalMs: 60_000, run: async () => {} });
  expect(() => scheduleExclusiveJob(ctx, { name: 'test:second', lockKey: 7_299_999_002, intervalMs: 60_000, run: async () => {} })).toThrow(
    /test:first.*test:second/,
  );
  expect(() => consumeOutbox(ctx, { name: 'test-consumer', topics: ['test'], lockKey: 7_299_999_002, handle: async () => {} })).toThrow(/test:first.*test-consumer/);
  return shutdown();
});
