import type { ServerContext } from '../../platform/context';
import { HttpError } from '../../platform/http';
import { log } from '../../platform/log';
import * as repo from './repo';
import { createUser } from './service';

export const DEMO_USER = { name: 'Demo User', email: 'demo@freero.app', password: 'freero123' };

export default async function initAuth(ctx: ServerContext): Promise<void> {
  const now = Date.now();
  await repo.deleteExpiredSessions(now);
  await repo.deleteExpiredTokens(now);
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
