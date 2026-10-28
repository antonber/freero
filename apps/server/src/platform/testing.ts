// Test fixture: a fresh in-memory Postgres (PGlite) with every module's migrations applied, and a
// loaded config. Module tests use this instead of touching the db themselves [S3].
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig, loadConfig, type Config } from './config';
import { closeDb, discoverMigrations, migrate, openDb } from './db';

const MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules');

export async function openTestDb(env: Record<string, string> = {}): Promise<Config> {
  const config = loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', ...env });
  await openDb({ pgliteDir: 'memory' });
  await migrate(discoverMigrations(MODULES_DIR));
  return config;
}

/** Closes the database and removes this process's local files (outbox, uploads). */
export async function closeTestDb(): Promise<void> {
  await closeDb();
  fs.rmSync(getConfig().dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
