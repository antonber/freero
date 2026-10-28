// The outbox on a real (in-memory) Postgres: events exist exactly when their transaction committed,
// and one bad event can't stall a consumer.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { tx } from './db';
import { appendOutbox, drainOutbox, registerOutboxConsumer, type OutboxEvent } from './outbox';
import { closeTestDb, openTestDb } from './testing';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

it('an event appended in a transaction that rolls back is never delivered; committed ones are, once, newest per key', async () => {
  const seen: OutboxEvent[] = [];
  registerOutboxConsumer({ name: 'test:commit', topics: ['test.commit'], lockKey: 9_900_001, handle: async (events) => void seen.push(...events) });

  await expect(
    tx(async () => {
      await appendOutbox('test.commit', 'k:lost', { n: 0 });
      throw new Error('rolled back');
    }),
  ).rejects.toThrow('rolled back');
  await tx(async () => {
    await appendOutbox('test.commit', 'k:a', { n: 1 });
    await appendOutbox('test.commit', 'k:b', { n: 2 });
  });
  await appendOutbox('test.commit', 'k:a', { n: 3 });
  await appendOutbox('test.other', 'k:a', { n: 4 }); // another topic: not this consumer's

  await drainOutbox('test:commit');
  expect(seen.map((e) => [e.key, e.payload])).toEqual([
    ['k:b', { n: 2 }],
    ['k:a', { n: 3 }],
  ]);
  await drainOutbox('test:commit');
  expect(seen).toHaveLength(2); // nothing twice
});

it('a batch that keeps failing on one event is retried, then only that event is skipped and the rest are handled', async () => {
  const handled: string[] = [];
  registerOutboxConsumer({
    name: 'test:poison',
    topics: ['test.poison'],
    lockKey: 9_900_002,
    async handle(events) {
      if (events.some((e) => e.key === 'bad')) throw new Error('cannot handle bad');
      handled.push(...events.map((e) => e.key));
    },
  });
  for (const k of ['one', 'bad', 'two']) await appendOutbox('test.poison', k);

  await expect(drainOutbox('test:poison')).rejects.toThrow('cannot handle bad');
  await expect(drainOutbox('test:poison')).rejects.toThrow('cannot handle bad');
  expect(handled).toEqual([]);
  await drainOutbox('test:poison'); // third attempt: one by one
  expect(handled).toEqual(['one', 'two']);
  await appendOutbox('test.poison', 'three');
  await drainOutbox('test:poison');
  expect(handled).toEqual(['one', 'two', 'three']);
});
