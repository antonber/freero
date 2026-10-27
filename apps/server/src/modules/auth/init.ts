import type { ServerContext } from '../../platform/context';
import { HttpError } from '../../platform/http';
import { log } from '../../platform/log';
import * as repo from './repo';
import { createUser } from './service';

export const DEMO_USER = { name: 'Demo User', email: 'demo@freero.app', password: 'freero123' };

export default async function initAuth(ctx: ServerContext): Promise<void> {
  await repo.deleteExpiredSessions(Date.now());
  if (!ctx.config.production && (await repo.countUsers()) === 0) {
    try {
      await createUser(DEMO_USER);
      log(`seeded demo user: ${DEMO_USER.email} / ${DEMO_USER.password}`);
    } catch (e) {
      // Another instance starting on the same database seeded it first.
      if (!(e instanceof HttpError && e.status === 409)) throw e;
    }
  }
}
