import { DISCOVERY_SOURCES } from '@freero/shared';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from './service';
import { discoverySourceCounts } from './signups';

beforeAll(() => openTestDb());
afterAll(() => closeTestDb());

const DAY = 24 * 60 * 60 * 1000;
/** A period start after every account made so far (created_at has millisecond resolution). */
function freshStart(): number {
  const at = Date.now() + 1;
  while (Date.now() < at) {
    /* the next millisecond */
  }
  return at;
}
const signUp = (n: string, discoverySource?: unknown) => createUser({ name: n, email: `${n}@test.freero.app`, password: 'password-123', discoverySource });

it('an answer to "How did you find Freero?" that is not one of the fixed ones, or none from a client that predates the question, never refuses the sign-up and counts as no answer', async () => {
  const since = freshStart();
  await expect(signUp('typed', 'my friend Ada at Acme')).resolves.toMatchObject({ email: 'typed@test.freero.app' });
  await expect(signUp('number', 3)).resolves.toBeTruthy();
  await expect(signUp('oldclient')).resolves.toBeTruthy();
  const counts = await discoverySourceCounts(since, Date.now() + DAY);
  expect(counts).toMatchObject({ none: 3, total: 3 });
  expect(Object.values(counts.answers).every((n) => n === 0)).toBe(true);
});

it('the sign-up sources count every answer the form offers, each under its own answer, and only for accounts created in the period', async () => {
  const before = await discoverySourceCounts(0, Date.now() + DAY);
  const since = freshStart();
  // Every answer the form offers is one the database accepts (its CHECK constraint is in step).
  for (const s of DISCOVERY_SOURCES) await signUp(`src-${s}`, s);
  await signUp('src-ai-2', 'ai_assistant');
  await signUp('src-skipped');
  const now = await discoverySourceCounts(since, Date.now() + DAY);
  expect(now.answers).toEqual({ ...Object.fromEntries(DISCOVERY_SOURCES.map((s) => [s, 1])), ai_assistant: 2 });
  expect(now).toMatchObject({ none: 1, total: DISCOVERY_SOURCES.length + 2 });
  // A period that ended before these sign-ups doesn't see them.
  expect(await discoverySourceCounts(0, since)).toEqual(before);
});
