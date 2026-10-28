import type { ServerContext } from '../../platform/context';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { endSessionsBeyondLimits, onEmailVerified, onTwoFactorRequirement, setSessionLimits } from '../auth/index';
import { convertInvitesFor } from './invites';
import { registerWorkspaceObjectTypes } from './objects';
import { allSessionLimits, sessionLimitsFor, twoFactorRequirementOf } from './service';

const SESSION_POLICY_LOCK_KEY = 7_202_610_351; // arbitrary, constant across releases

export default function initWorkspaces(ctx: ServerContext): void {
  registerWorkspaceObjectTypes();
  // Someone proved an address: the pending workspace invites sent to it become memberships.
  const stop = onEmailVerified(convertInvitesFor);
  ctx.onShutdown(() => void stop());

  // A workspace that requires two-step verification: its members can't turn it off (auth's seam);
  // without it, its boards stay closed to them (boardAccess `blocked`).
  const stopTwoFactor = onTwoFactorRequirement(twoFactorRequirementOf);
  ctx.onShutdown(() => void stopTwoFactor());

  // Session lifetime / idle limits (KAI-51): auth checks every request against the person's
  // strictest limits, and this job ends sessions nobody uses any more (closing their sockets on
  // every instance). Idempotent; one instance at a time.
  setSessionLimits(sessionLimitsFor);
  scheduleExclusiveJob(ctx, {
    name: 'workspaces:session-policy',
    lockKey: SESSION_POLICY_LOCK_KEY,
    intervalMs: 60_000,
    firstRunMs: 15_000 + Math.random() * 30_000,
    run: async () => {
      const n = await endSessionsBeyondLimits(await allSessionLimits());
      if (n > 0) log(`workspaces: ended ${n} session(s) under workspace session policies`);
    },
  });
}
