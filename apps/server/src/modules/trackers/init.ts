// Tracker sync's background work: the outbox consumer (board changes and queued syncs), the job
// that polls trackers and retries failed syncs, the issue object type, and erasing a person's own
// tracker credentials when their account is signed out everywhere.
import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { logError } from '../../platform/log';
import { consumeOutbox } from '../../platform/outbox';
import { onSignedOutEverywhere } from '../auth/index';
import { registerIssueObjects } from './objects';
import * as repo from './repo';
import { pollOnce, trackersConsumer } from './service';

const POLL_LOCK_KEY = 7_202_611_101; // arbitrary, constant across releases

export default function initTrackers(ctx: ServerContext): void {
  registerIssueObjects();
  consumeOutbox(ctx, trackersConsumer);
  scheduleExclusiveJob(ctx, {
    name: 'trackers:poll',
    lockKey: POLL_LOCK_KEY,
    intervalMs: Math.min(15_000, ctx.config.trackers.pollMs),
    run: () => pollOnce().then(() => undefined),
  });
  // An account taken back (password reset, "this wasn't me", suspension…) must not keep a way
  // into the person's tracker: their own connections need to be connected again.
  onSignedOutEverywhere((userId) => {
    void repo.revokePersonalCredentials(userId).catch((e) => logError('trackers: could not revoke personal tracker credentials', e));
  });
}
