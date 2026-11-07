// The poll job against the repo's mock GitHub (scripts/lib/mock-github.mjs): failed syncs it
// retries must survive a poll that never finishes (a deploy, a crash, a database blip mid-run).
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Account } from '@freero/shared';
// @ts-expect-error -- a plain .mjs test double without types
import { startMockGithub } from '../../../../../scripts/lib/mock-github.mjs';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { createConnection } from './connections';
import { github } from './providers/github';
import * as repo from './repo';
import { importIssues, pollOnce, TRACKERS_CONSUMER, trackersConsumer } from './service';

const ORIGIN = 'http://freero.test';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gh: any;
beforeAll(async () => {
  await openTestDb({ PUBLIC_URL: ORIGIN, TRACKER_PRIVATE_ENDPOINTS: 'true' });
  gh = await startMockGithub();
  registerOutboxConsumer(trackersConsumer);
});
afterAll(async () => {
  await gh?.close();
  await closeTestDb();
});

const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}@polling.test.freero.app`, password: 'password-123' }, { emailVerified: true });

it('a failed sync whose retry a tracker poll took is still retried when that poll is cut short before it finishes', async () => {
  const owner = await user('Linker');
  const board = await createBoard(owner.id, 'Sync board', '');
  const { connection } = await createConnection(owner.id, { provider: 'github', name: 'GitHub', site: gh.url, token: gh.token, defaults: { project: 'acme/retry' } }, null);
  gh.create('acme/retry', { title: 'Checkout bug' });
  const linkId = (await importIssues(owner.id, board.id, { connectionId: connection.id, query: 'repo:acme/retry' }, ORIGIN)).cards![0]!.linkId;
  await drainOutbox(TRACKERS_CONSUMER);
  // The tracker was rate limiting: the link waits for its retry, which is due now.
  await repo.markFailed(linkId, 'error', 'GitHub is rate limiting', Date.now() - 1000);

  // The poll takes the retry, then hangs on the tracker; the process stops there.
  const orig = github.changedSince;
  let reached!: () => void;
  const polling = new Promise<void>((res) => (reached = res));
  let release!: () => void;
  const hang = new Promise<string[]>((res) => (release = () => res([])));
  github.changedSince = async () => (reached(), hang);
  try {
    void pollOnce(Date.now() + 24 * 3_600_000).catch(() => {});
    await polling;
    await drainOutbox(TRACKERS_CONSUMER); // whatever the poll left queued is synced
    const link = await repo.getLink(linkId);
    expect({ state: link?.state, waitingForRetry: link?.retryAt !== null }).toEqual({ state: 'ok', waitingForRetry: false });
  } finally {
    release();
    github.changedSince = orig;
  }
});
