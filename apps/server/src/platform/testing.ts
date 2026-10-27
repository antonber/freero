// Test fixture: a fresh in-memory Postgres (PGlite) with every module's migrations applied, and a
// loaded config. Module tests use this instead of touching the db themselves [S3].
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig, type Config } from './config';
import { closeDb, discoverMigrations, migrate, openDb } from './db';

const MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules');

export async function openTestDb(env: Record<string, string> = {}): Promise<Config> {
  const config = loadConfig({ NODE_ENV: 'test', FREERO_DATA_DIR: 'memory', ...env });
  await openDb({ pgliteDir: 'memory' });
  await migrate(discoverMigrations(MODULES_DIR));
  return config;
}

export const closeTestDb = closeDb;
