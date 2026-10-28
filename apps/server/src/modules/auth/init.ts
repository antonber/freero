import type { ServerContext } from '../../platform/context';
import { HttpError } from '../../platform/http';
import { scheduleExclusiveJob } from '../../platform/jobs';
import { log } from '../../platform/log';
import { openGeoIp } from './geoip';
import { processTwoFactorRecoveries } from './recovery';
import * as repo from './repo';
import { createUser, DEVICE_TTL_MS } from './service';
import { resealTwoFactorSecrets } from './twoFactor';

const RESEAL_LOCK_KEY = 7_202_610_284; // arbitrary, constant across releases
const RECOVERY_LOCK_KEY = 7_202_610_301; // arbitrary, constant across releases

export const DEMO_USER = { name: 'Demo User', email: 'demo@freero.app', password: 'freero123' };

export default async function initAuth(ctx: ServerContext): Promise<void> {
  const now = Date.now();
  await repo.deleteExpiredSessions(now);
  await repo.deleteExpiredTokens(now);
  await repo.deleteExpiredAuthFlows(now);
  await repo.deleteDevicesUnseenSince(now - DEVICE_TTL_MS);
  if (ctx.config.geoipDbPath) await openGeoIp(ctx.config.geoipDbPath);
  if (ctx.config.sessionSecretsPrevious.length) scheduleResealing(ctx);
  scheduleExclusiveJob(ctx, {
    name: 'auth:two-factor-recovery',
    lockKey: RECOVERY_LOCK_KEY,
    // Every 10 minutes (a recovery's mails go out at most that late); more often with the short
    // delays of a test setup.
    intervalMs: Math.max(500, Math.min(10 * 60_000, ctx.config.twoFactorRecoveryDelayMs / 8)),
    run: async () => {
      const { reminded, ready } = await processTwoFactorRecoveries();
      if (reminded || ready) log(`auth: two-step recovery: ${reminded} reminder(s), ${ready} ready link(s) mailed`);
    },
  });
  if (ctx.config.production) return;
  if ((await repo.countUsers()) === 0) {
    try {
      // Verified, so the demo account can invite and share without a mail round-trip.
      await createUser(DEMO_USER, { emailVerified: true });
      log(`seeded demo user: ${DEMO_USER.email} / ${DEMO_USER.password}`);
    } catch (e) {
      // Another instance starting on the same database seeded it first.
      if (!(e instanceof HttpError && e.status === 409)) throw e;
    }
  } else {
    // Dev databases seeded before email verification existed.
    const demo = await repo.findUserByEmail(DEMO_USER.email);
    if (demo && !demo.emailVerified) await repo.markEmailVerified(demo.id, demo.email, now);
  }
}

/**
 * While SESSION_SECRET_PREVIOUS is set (a rotation is settling), seals stored authenticator
 * secrets under the current SESSION_SECRET — soon after startup, then hourly — and says in the log
 * when that is done.
 */
function scheduleResealing(ctx: ServerContext): void {
  scheduleExclusiveJob(ctx, {
    name: 'auth:reseal-two-factor',
    lockKey: RESEAL_LOCK_KEY,
    intervalMs: 3_600_000,
    run: async () => {
      const { resealed, unreadable } = await resealTwoFactorSecrets();
      if (resealed) log(`auth: sealed ${resealed} two-step verification secret(s) again under the current SESSION_SECRET`);
      if (unreadable)
        log(
          `auth: ${unreadable} two-step verification secret(s) open with no configured SESSION_SECRET (made under a secret that is no longer configured); those people sign in with a recovery code and enrol again`,
        );
      // Repeated every run on purpose: a reminder to finish the rotation.
      log('auth: every readable two-step verification secret is sealed under the current SESSION_SECRET; SESSION_SECRET_PREVIOUS can be removed once every instance runs with it');
    },
  });
}
