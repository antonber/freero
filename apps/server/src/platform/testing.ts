// Test fixture: a fresh in-memory Postgres (PGlite) with every module's migrations applied, and a
// loaded config. Module tests use this instead of touching the db themselves [S3].
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, loadConfig, type Config } from './config';
import { mailIdle, onOutboxMail, outboxDir, type Mail } from './mail';
import { closeDb, discoverMigrations, migrate, openDb } from './db';

const MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules');

export async function openTestDb(env: Record<string, string> = {}): Promise<Config> {
  const config = loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', ...env });
  await openDb({ pgliteDir: 'memory' });
  await migrate(discoverMigrations(MODULES_DIR));
  return config;
}

/** Closes the database and removes this process's local files (outbox, uploads), once mail sent in the background has landed. */
export async function closeTestDb(): Promise<void> {
  await mailIdle();
  await closeDb();
  fs.rmSync(getConfig().dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

export { mailIdle };
/** Statements run so far (assert that a batched read stays one batch as its input grows). */
export { queryCount } from './db';

/** Every mail in this process's dev outbox, oldest first. */
export function outboxMails(): Array<Mail & { sentAt: number }> {
  const dir = outboxDir();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Mail & { sentAt: number })
    .sort((a, b) => a.sentAt - b.sentAt);
}

/**
 * The first capture group of `link` in the newest mail to `to` that has one: already in the outbox,
 * or in the next such mail written (mail sent in the background lands after the action returns).
 * No deadline of its own; the test's timeout bounds it.
 */
export function mailedLink(to: string, link: RegExp): Promise<string> {
  return new Promise((resolve) => {
    const find = (mails: Mail[]) =>
      mails
        .filter((m) => m.to === to)
        .map((m) => link.exec(m.text)?.[1])
        .filter((t): t is string => !!t)
        .at(-1);
    const off = onOutboxMail((m) => {
      const t = find([m]);
      if (t) {
        off();
        resolve(t);
      }
    });
    const already = find(outboxMails());
    if (already) {
      off();
      resolve(already);
    }
  });
}
