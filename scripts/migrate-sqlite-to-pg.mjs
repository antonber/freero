#!/usr/bin/env node
// Copies a dev database from before the move to Postgres (SQLite, data/freero.db) into the current
// database, so existing local accounts, boards and board content survive.
//
//   npm run db:import-sqlite                      # data/freero.db -> the app's database
//   npm run db:import-sqlite -- --from <file.db>  # another SQLite file
//   npm run db:import-sqlite -- --dry-run         # report only, write nothing
//
// Target: DATABASE_URL when set, else the built-in PGlite database (<FREERO_DATA_DIR or data>/pg)
// — stop the dev server first (PGlite serves one process). The schema is created/updated with the
// server's own migrations. Safe to run again: rows that already exist are kept as they are. A
// SQLite account whose email already exists in the target (e.g. the demo user the new server
// seeded) is merged into that account. The source is never modified: it is read from a copy.
//
// Runs with tsx (it uses the server's db layer): `npx tsx scripts/migrate-sqlite-to-pg.mjs`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../apps/server/src/platform/config';
import { closeDb, discoverMigrations, migrate, openDb, query, redactUrl, tx } from '../apps/server/src/platform/db';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULES_DIR = path.join(ROOT, 'apps/server/src/modules');

class Rollback extends Error {}

// node:sqlite prints an "experimental" warning on load; it is only read here, so keep the output clean.
const emitWarning = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : emitWarning.call(process, w, ...rest));
const { DatabaseSync } = await import('node:sqlite');

function args() {
  const a = process.argv.slice(2);
  const out = { from: null, dryRun: false };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--from') out.from = a[++i];
    else if (a[i] === '--dry-run') out.dryRun = true;
    else if (a[i] === '--help' || a[i] === '-h') {
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 16).join('\n'));
      process.exit(0);
    } else throw new Error(`unknown argument ${a[i]} (try --help)`);
  }
  return out;
}

/** Reads every table of a COPY of the SQLite db (with its -wal/-shm, where recent writes live). */
function readSqlite(file) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-sqlite-import-'));
  try {
    for (const suffix of ['', '-wal', '-shm']) {
      if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, path.join(tmp, 'freero.db' + suffix));
    }
    const db = new DatabaseSync(path.join(tmp, 'freero.db'));
    try {
      const tables = new Set(db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all().map((r) => r.name));
      const all = (t) => (tables.has(t) ? db.prepare(`SELECT * FROM ${t}`).all() : []);
      return {
        users: all('users'),
        sessions: all('sessions'),
        boards: all('boards'),
        board_stars: all('board_stars'),
        board_opens: all('board_opens'),
        board_members: all('board_members'),
        board_docs: all('board_docs'),
      };
    } finally {
      db.close();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const date = (ms) => new Date(Number(ms));

async function main() {
  const opts = args();
  const config = loadConfig();
  const source = path.resolve(opts.from ?? path.join(config.dataDir, 'freero.db'));
  if (!fs.existsSync(source)) {
    console.error(`No SQLite database at ${source}. Pass --from <path/to/freero.db>.`);
    process.exit(1);
  }
  const src = readSqlite(source);
  const target = config.databaseUrl ? `Postgres ${redactUrl(config.databaseUrl)}` : `PGlite ${config.pgliteDir}`;
  console.log(`source: ${source}\ntarget: ${target}${opts.dryRun ? ' (dry run)' : ''}\n`);

  await openDb(config.databaseUrl ? { url: config.databaseUrl, poolSize: 2 } : { pgliteDir: config.pgliteDir });
  const report = [];
  try {
    const applied = await migrate(discoverMigrations(MODULES_DIR));
    if (applied.length) console.log(`schema: applied ${applied.join(', ')}\n`);

    await tx(async () => {
      const count = (table) => {
        const r = { table, copied: 0, existing: 0, skipped: 0, notes: [] };
        report.push(r);
        return r;
      };
      const insert = async (r, sql, params) => {
        const rows = await query(`${sql} ON CONFLICT DO NOTHING RETURNING 1`, params);
        if (rows.length) r.copied++;
        else r.existing++;
      };

      // users — merged by email into an existing account (ids remapped everywhere below)
      const userId = new Map(); // sqlite id -> target id
      const u = count('users');
      for (const row of src.users) {
        const email = String(row.email).toLowerCase();
        const [existing] = await query(`SELECT id FROM users WHERE email = $1 OR id = $2 ORDER BY (id = $2) DESC`, [email, row.id]);
        if (existing && existing.id !== row.id) {
          userId.set(row.id, existing.id);
          u.existing++;
          u.notes.push(`${email}: already exists here; its boards, stars and memberships move to that account`);
          continue;
        }
        userId.set(row.id, row.id);
        await insert(
          u,
          `INSERT INTO users (id, email, name, password_hash, color, avatar_url, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [row.id, email, row.name, row.password_hash, row.color, row.avatar_url ?? null, date(row.created_at)],
        );
      }
      const users = new Set((await query(`SELECT id FROM users`)).map((r) => r.id));
      const mapUser = (id) => {
        const t = userId.get(id) ?? id;
        return users.has(t) ? t : null;
      };

      const s = count('sessions');
      for (const row of src.sessions) {
        const uid = mapUser(row.user_id);
        if (!uid || userId.get(row.user_id) !== row.user_id) {
          s.skipped++; // orphaned, or its account was merged (sign in again)
          continue;
        }
        await insert(s, `INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ($1, $2, $3, $4)`, [
          row.token_hash,
          uid,
          date(row.created_at),
          date(row.expires_at),
        ]);
      }

      const b = count('boards');
      for (const row of src.boards) {
        const owner = mapUser(row.owner_id);
        if (!owner) {
          b.skipped++;
          b.notes.push(`board ${row.id}: its owner ${row.owner_id} does not exist`);
          continue;
        }
        await insert(
          b,
          `INSERT INTO boards (id, title, description, owner_id, link_access, thumbnail, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [row.id, row.title, row.description ?? '', owner, row.link_access ?? 'none', row.thumbnail ?? null, date(row.created_at), date(row.updated_at)],
        );
      }
      const boards = new Map((await query(`SELECT id, owner_id FROM boards`)).map((r) => [r.id, r.owner_id]));

      const perUser = async (table, rows, cols, extra) => {
        const r = count(table);
        for (const row of rows) {
          const uid = mapUser(row.user_id);
          if (!uid || !boards.has(row.board_id) || extra?.skip?.(row, uid)) {
            r.skipped++;
            continue;
          }
          await insert(r, `INSERT INTO ${table} (board_id, user_id, ${cols.join(', ')}) VALUES ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(', ')})`, [
            row.board_id,
            uid,
            ...cols.map((c) => (c.endsWith('_at') ? date(row[c]) : row[c])),
          ]);
        }
      };
      await perUser('board_stars', src.board_stars, ['created_at']);
      await perUser('board_opens', src.board_opens, ['opened_at']);
      // A member who (after an account merge) is the owner stays just the owner.
      await perUser('board_members', src.board_members, ['role', 'created_at'], { skip: (row, uid) => boards.get(row.board_id) === uid });

      const d = count('board_docs');
      for (const row of src.board_docs) {
        if (!boards.has(row.board_id)) {
          d.skipped++;
          continue;
        }
        // Existing content in the target is newer than the old file: never overwritten.
        await insert(d, `INSERT INTO board_docs (board_id, state, updated_at) VALUES ($1, $2, $3)`, [
          row.board_id,
          Buffer.from(row.state),
          date(row.updated_at),
        ]);
      }

      if (opts.dryRun) throw new Rollback();
    }).catch((e) => {
      if (!(e instanceof Rollback)) throw e;
    });
  } finally {
    await closeDb();
  }

  console.log('table          copied  already there  skipped');
  for (const r of report) {
    console.log(`${r.table.padEnd(14)} ${String(r.copied).padStart(6)}  ${String(r.existing).padStart(13)}  ${String(r.skipped).padStart(7)}`);
    for (const n of r.notes) console.log(`               - ${n}`);
  }

  // Uploaded files are referenced by URL (/uploads/<file>); they live next to the old database.
  const fromUploads = path.join(path.dirname(source), 'uploads');
  if (fs.existsSync(fromUploads) && path.resolve(fromUploads) !== path.resolve(config.uploadsDir)) {
    if (config.s3) console.log(`\nUploads: copy ${fromUploads} into bucket ${config.s3.bucket} (same file names) yourself.`);
    else if (!opts.dryRun) {
      fs.mkdirSync(config.uploadsDir, { recursive: true });
      let n = 0;
      for (const f of fs.readdirSync(fromUploads)) {
        const to = path.join(config.uploadsDir, f);
        if (!fs.existsSync(to)) {
          fs.copyFileSync(path.join(fromUploads, f), to);
          n++;
        }
      }
      console.log(`\nUploads: copied ${n} file(s) to ${config.uploadsDir}.`);
    }
  }
  console.log(opts.dryRun ? '\nDry run: nothing was written.' : `\nDone. ${source} was not modified; delete it once you are happy.`);
}

main().catch((e) => {
  console.error(`import failed: ${e.message}`);
  process.exit(1);
});
