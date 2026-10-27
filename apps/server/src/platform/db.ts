// The single SQLite connection. Only modules/*/repo.ts (and the composition root) import this [S3].
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

let instance: DatabaseSync | null = null;
const statements = new Map<string, StatementSync>();

export function openDb(file: string): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  instance = new DatabaseSync(file);
  instance.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;');
  statements.clear();
  return instance;
}

export function db(): DatabaseSync {
  if (!instance) throw new Error('Database not open');
  return instance;
}

/** Cached prepared statement. */
export function sql(text: string): StatementSync {
  let s = statements.get(text);
  if (!s) {
    s = db().prepare(text);
    statements.set(text, s);
  }
  return s;
}

/** Runs fn inside a transaction. */
export function transaction<T>(fn: () => T): T {
  const d = db();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

/** Applies a module's schema.sql (idempotent CREATE ... IF NOT EXISTS statements). */
export function runSchema(text: string): void {
  db().exec(text);
}

export function closeDb(): void {
  statements.clear();
  instance?.close();
  instance = null;
}
