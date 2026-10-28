// The one database API: PostgreSQL through `pg` when DATABASE_URL is set, otherwise PGlite (real
// Postgres compiled to WASM, in-process) persisted under <data>/pg, or in memory for tests.
// Same SQL dialect everywhere; placeholders are $1, $2, ...
//
// Only modules/*/repo.ts (plus platform/ and the composition root) import this [S3].
//
// Transactions: `tx(fn)` runs fn on one connection inside BEGIN/COMMIT (ROLLBACK if fn throws).
// Every query issued while fn runs — through the handle it receives OR through the module-level
// query/one/exec, from any repo — joins that transaction (AsyncLocalStorage). So a route can wrap
// calls into several modules in one transaction without passing handles around. A tx() inside a
// tx() joins the outer one.
// Never await, inside a transaction, work that was started OUTSIDE it and queries the database
// (e.g. a promise created before tx() began): on PGlite (one connection) that work waits for the
// transaction to end, and the transaction waits for it — a deadlock.
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import type { PGlite, Transaction as PGliteTx } from '@electric-sql/pglite';

export type Row = Record<string, unknown>;

/** The database could not be opened or migrated at startup (message is meant for the operator). */
export class DatabaseStartupError extends Error {}

export interface Queryable {
  /** Runs one parameterized statement; returns its rows. */
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  /** The first row, or null. */
  one<T = Row>(sql: string, params?: unknown[]): Promise<T | null>;
  /** Runs one or more statements without parameters (DDL, migrations). */
  exec(sql: string): Promise<void>;
}

/** A transaction-scoped handle (see tx()). */
export type Tx = Queryable;

export type DbOptions =
  /** Real Postgres. `poolSize` = max connections this process opens. */
  | { url: string; poolSize: number }
  /** PGlite persisted in `dir`, or in memory when dir is 'memory'. */
  | { pgliteDir: string | 'memory' };

interface Driver {
  readonly kind: 'pg' | 'pglite';
  query(sql: string, params: unknown[]): Promise<Row[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (q: Queryable) => Promise<T>): Promise<T>;
  /** Takes a session-level advisory lock without waiting; returns its release, or null if held elsewhere. */
  tryLock(key: number): Promise<(() => Promise<void>) | null>;
  close(): Promise<void>;
}

const withOne = (q: Pick<Queryable, 'query' | 'exec'>): Queryable => ({
  query: q.query,
  exec: q.exec,
  async one<T>(sql: string, params?: unknown[]) {
    return ((await q.query<T>(sql, params))[0] ?? null) as T | null;
  },
});

// ---------------------------------------------------------------------------
// Drivers
// ---------------------------------------------------------------------------

// bigint (int8) as a JS number, like PGlite does: our int8 values are counts, sizes and epochs.
const INT8_OID = 20;
const pgTypes = {
  getTypeParser: ((oid: number, format?: string) =>
    oid === INT8_OID ? (v: string) => Number(v) : pg.types.getTypeParser(oid, format as 'text')) as typeof pg.types.getTypeParser,
};

/** postgres://user:secret@host/db -> postgres://user:***@host/db (for error messages). */
export function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = '***';
    return u.toString();
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

async function openPg(url: string, poolSize: number): Promise<Driver> {
  const pool = new pg.Pool({ connectionString: url, max: poolSize, connectionTimeoutMillis: 5000, types: pgTypes });
  // An idle client losing its connection (Postgres restart) must not crash the process; the pool
  // replaces it on the next checkout.
  pool.on('error', (err) => console.error('[freero db] idle Postgres connection error:', err.message));
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    await pool.end().catch(() => {});
    throw new DatabaseStartupError(
      `Cannot reach Postgres at ${redactUrl(url)}: ${(e as Error).message}. ` +
        'Check DATABASE_URL (and that the database is running), or unset it to use the built-in PGlite database.',
    );
  }
  const q = (client: pg.Pool | pg.PoolClient) => ({
    async query(sql: string, params: unknown[] = []) {
      return (await client.query(sql, params)).rows as Row[];
    },
    async exec(sql: string) {
      await client.query(sql);
    },
  });
  const poolQ = q(pool);
  return {
    kind: 'pg',
    query: poolQ.query,
    exec: poolQ.exec,
    async transaction(fn) {
      const client = await pool.connect();
      let broken: Error | undefined;
      try {
        await client.query('BEGIN');
        const out = await fn(withOne(q(client) as Queryable));
        await client.query('COMMIT');
        return out;
      } catch (e) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          broken = rollbackErr as Error; // connection is unusable: destroy it instead of reusing it
        }
        throw e;
      } finally {
        client.release(broken);
      }
    },
    async tryLock(key) {
      // A session lock lives on one connection: keep a dedicated client until it is released.
      const client = await pool.connect();
      try {
        const r = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key]);
        if (r.rows[0]?.ok === true) {
          return async () => {
            try {
              await client.query('SELECT pg_advisory_unlock($1)', [key]);
              client.release();
            } catch (e) {
              client.release(e as Error); // the lock dies with the connection
            }
          };
        }
      } catch (e) {
        client.release(e as Error);
        throw e;
      }
      client.release();
      return null;
    },
    close: () => pool.end(),
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * PGlite is single-process: a second process opening the same directory would corrupt it. Take
 * an exclusive lock file (stale locks of dead processes are taken over).
 */
function lockDir(dir: string): () => void {
  // Beside the directory, not in it: PGlite initializes a new database only in an empty directory.
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  const file = `${dir}.lock`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && pidAlive(pid))
        throw new DatabaseStartupError(
          `The database in ${dir} is in use by another Freero process (pid ${pid}). The built-in PGlite ` +
            'database serves one process only: stop the other server, use another FREERO_DATA_DIR, or set ' +
            'DATABASE_URL to share a real Postgres between instances.',
        );
      fs.rmSync(file, { force: true }); // stale: its process is gone
    }
  }
  throw new Error(`Could not lock ${file}`);
}

const pgliteLocks = new Set<number>();

async function openPglite(dir: string | 'memory'): Promise<Driver> {
  const { PGlite } = await import('@electric-sql/pglite');
  const unlock = dir === 'memory' ? () => {} : lockDir(dir);
  let db: PGlite;
  try {
    db = new PGlite(dir === 'memory' ? undefined : dir.split(path.sep).join('/'));
    await db.waitReady;
  } catch (e) {
    unlock();
    throw new DatabaseStartupError(`Could not open the PGlite database in ${dir}: ${(e as Error).message}`);
  }
  const q = (h: PGlite | PGliteTx) => ({
    async query(sql: string, params: unknown[] = []) {
      return (await h.query<Row>(sql, params)).rows;
    },
    async exec(sql: string) {
      await h.exec(sql);
    },
  });
  const top = q(db);
  return {
    kind: 'pglite',
    query: top.query,
    exec: top.exec,
    transaction: (fn) => db.transaction((t) => fn(withOne(q(t) as Queryable))),
    // One process per PGlite directory (lockDir), so an in-process lock is a database-wide one.
    async tryLock(key) {
      if (pgliteLocks.has(key)) return null;
      pgliteLocks.add(key);
      return async () => void pgliteLocks.delete(key);
    },
    async close() {
      try {
        await db.close();
      } finally {
        unlock();
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The connection + transaction scope
// ---------------------------------------------------------------------------

let driver: Driver | null = null;

interface Scope {
  handle: Queryable;
  open: boolean;
}
const scope = new AsyncLocalStorage<Scope>();

export async function openDb(opts: DbOptions): Promise<void> {
  if (driver) throw new Error('Database already open');
  driver = 'url' in opts ? await openPg(opts.url, opts.poolSize) : await openPglite(opts.pgliteDir);
}

function d(): Driver {
  if (!driver) throw new Error('Database not open: main.ts opens it before modules run');
  return driver;
}

/** 'pg' (real Postgres) or 'pglite'. */
export function dbKind(): 'pg' | 'pglite' {
  return d().kind;
}

/** The transaction the caller runs in, if any (a scope outliving its transaction is ignored). */
function current(): Queryable | null {
  const s = scope.getStore();
  return s?.open ? s.handle : null;
}

export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  const t = current();
  return (t ? t.query<T>(sql, params) : d().query(sql, params)) as Promise<T[]>;
}

export async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  return ((await query<T>(sql, params))[0] ?? null) as T | null;
}

export async function exec(sql: string): Promise<void> {
  const t = current();
  return t ? t.exec(sql) : d().exec(sql);
}

/** Runs fn in a transaction (see the header comment). Rolls back and rethrows if fn throws. */
export async function tx<T>(fn: (t: Tx) => Promise<T>): Promise<T> {
  const outer = current();
  if (outer) return fn(outer);
  return d().transaction(async (handle) => {
    const s: Scope = { handle, open: true };
    try {
      return await scope.run(s, () => fn(handle));
    } finally {
      // Timers/callbacks created inside fn keep this scope; they must use the pool afterwards.
      s.open = false;
    }
  });
}

/**
 * Runs fn while holding the Postgres advisory lock `key`, or returns null right away when another
 * instance (or another call in this one) holds it. For periodic jobs every instance schedules but
 * only one may run at a time (account purge). fn's queries use the pool as usual; the lock is held
 * on a separate connection and released when fn settles (or when that connection dies).
 */
export async function withAdvisoryLock<T>(key: number, fn: () => Promise<T>): Promise<T | null> {
  if (heldLocks.has(key)) return null;
  heldLocks.add(key);
  try {
    const release = await d().tryLock(key);
    if (!release) return null;
    try {
      return await fn();
    } finally {
      await release();
    }
  } finally {
    heldLocks.delete(key);
  }
}
const heldLocks = new Set<number>();

/** Readiness probe. */
export async function pingDb(): Promise<void> {
  await d().query('SELECT 1', []);
}

export async function closeDb(): Promise<void> {
  const dr = driver;
  driver = null;
  await dr?.close();
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

const pgCode = (e: unknown): string | undefined => (e as { code?: unknown })?.code as string | undefined;
const pgConstraint = (e: unknown): string | undefined => (e as { constraint?: unknown })?.constraint as string | undefined;

/** A unique/primary-key violation (optionally on a specific constraint name). */
export function isUniqueViolation(e: unknown, constraint?: string): boolean {
  return pgCode(e) === '23505' && (!constraint || pgConstraint(e) === constraint);
}

/** A foreign-key violation: the referenced row (e.g. the board) does not exist (any more). */
export function isForeignKeyViolation(e: unknown): boolean {
  return pgCode(e) === '23503';
}

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------

export interface Migration {
  /** '<module>/<file>' — the key recorded in _migrations. */
  id: string;
  module: string;
  /** YYYYMMDDHHMM */
  stamp: string;
  file: string;
  sql: string;
  checksum: string;
}

export const MIGRATION_FILE_RE = /^(\d{12})_([a-z0-9_]+)\.sql$/;

/** Any process starting migrations takes this Postgres advisory lock first. */
const MIGRATION_LOCK_KEY = 7_202_610_270; // arbitrary, constant across releases

/**
 * Reads modules/<m>/migrations/*.sql under `modulesDir`, in global order: timestamp, then module,
 * then file name. Fails on a file that does not follow <YYYYMMDDHHMM>_<name>.sql.
 */
export function discoverMigrations(modulesDir: string): Migration[] {
  const out: Migration[] = [];
  for (const mod of fs.readdirSync(modulesDir, { withFileTypes: true })) {
    if (!mod.isDirectory()) continue;
    const dir = path.join(modulesDir, mod.name, 'migrations');
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      const m = MIGRATION_FILE_RE.exec(file);
      if (!m)
        throw new DatabaseStartupError(
          `modules/${mod.name}/migrations/${file}: migration files are named <YYYYMMDDHHMM>_<snake_name>.sql ` +
            `(e.g. ${new Date().toISOString().replace(/\D/g, '').slice(0, 12)}_add_column.sql).`,
        );
      // Line endings depend on the checkout (git autocrlf); the checksum must not.
      const sql = fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
      out.push({
        id: `${mod.name}/${file}`,
        module: mod.name,
        stamp: m[1],
        file,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      });
    }
  }
  return out.sort((a, b) => a.stamp.localeCompare(b.stamp) || a.module.localeCompare(b.module) || a.file.localeCompare(b.file));
}

/**
 * Applies every migration not yet recorded in _migrations, in order, in ONE transaction holding
 * an advisory lock: instances starting at the same time wait for each other, and a failing
 * migration leaves nothing behind. Refuses to start when an applied migration was edited.
 * Returns the ids applied now.
 */
export async function migrate(migrations: Migration[]): Promise<string[]> {
  return tx(async (t) => {
    await t.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK_KEY]);
    await t.exec(`CREATE TABLE IF NOT EXISTS _migrations (
      id         text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Map(
      (await t.query<{ id: string; checksum: string }>('SELECT id, checksum FROM _migrations')).map((r) => [r.id, r.checksum]),
    );
    const done: string[] = [];
    for (const m of migrations) {
      const sum = applied.get(m.id);
      if (sum !== undefined) {
        if (sum !== m.checksum)
          throw new DatabaseStartupError(
            `modules/${m.module}/migrations/${m.file} was edited after it was applied to this database. ` +
              'Applied migrations are immutable: revert the edit and add a new migration with a later timestamp. ' +
              '(Local dev only: deleting the data dir starts from scratch.)',
          );
        continue;
      }
      try {
        await t.exec(m.sql);
      } catch (e) {
        throw new DatabaseStartupError(`migration modules/${m.module}/migrations/${m.file} failed: ${(e as Error).message}`, { cause: e });
      }
      await t.query('INSERT INTO _migrations (id, checksum) VALUES ($1, $2)', [m.id, m.checksum]);
      done.push(m.id);
    }
    return done;
  });
}
