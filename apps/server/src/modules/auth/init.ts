import type { ServerContext } from '../../platform/context';
import { log } from '../../platform/log';
import * as repo from './repo';
import { createUser } from './service';

export const DEMO_USER = { name: 'Demo User', email: 'demo@freero.app', password: 'freero123' };

export default async function initAuth(ctx: ServerContext): Promise<void> {
  repo.deleteExpiredSessions(Date.now());
  if (!ctx.config.production && repo.countUsers() === 0) {
    await createUser(DEMO_USER);
    log(`seeded demo user: ${DEMO_USER.email} / ${DEMO_USER.password}`);
  }
}
