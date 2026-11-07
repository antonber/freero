// Every module's init.ts together, as main.ts runs them at startup. Two background jobs or outbox
// consumers on one advisory lock key would each skip the other's runs on every instance (a tracker
// poll stalling the search index, a KMS check stalling workspace blueprints); the scheduler refuses
// that as they register, so here every module must start without colliding.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { Config } from './platform/config';
import { createContext, type ServerContext } from './platform/context';
import { closeTestDb, openTestDb } from './platform/testing';

const MODULES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'modules');

let config: Config;
beforeAll(async () => {
  // Settings that schedule the jobs that are off by default too (a SESSION_SECRET rotation).
  config = await openTestDb({ SESSION_SECRET_PREVIOUS: 'an-older-session-secret-of-at-least-32-chars' });
});
afterAll(() => closeTestDb());

it('every module’s background jobs and outbox consumers start together without two of them sharing an advisory lock key', async () => {
  const ctx = createContext(config);
  const failures: string[] = [];
  try {
    for (const name of fs.readdirSync(MODULES_DIR).sort()) {
      const file = path.join(MODULES_DIR, name, 'init.ts');
      if (!fs.existsSync(file)) continue;
      const init = (await import(pathToFileURL(file).href)) as { default: (ctx: ServerContext) => void | Promise<void> };
      try {
        await init.default(ctx);
      } catch (e) {
        failures.push(`${name}: ${(e as Error).message}`);
      }
    }
  } finally {
    await ctx.shutdown();
  }
  expect(failures).toEqual([]);
}, 60_000);
