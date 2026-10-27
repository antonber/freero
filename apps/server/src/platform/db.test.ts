import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, discoverMigrations, exec, migrate, one, openDb, query, tx } from './db';

let dir: string;
const write = (mod: string, file: string, sql: string) => {
  fs.mkdirSync(path.join(dir, mod, 'migrations'), { recursive: true });
  fs.writeFileSync(path.join(dir, mod, 'migrations', file), sql);
};
const tableExists = async (t: string) => (await one<{ t: string | null }>(`SELECT to_regclass($1)::text AS t`, [t]))!.t !== null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-migrations-'));
  await openDb({ pgliteDir: 'memory' });
});
afterEach(async () => {
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('migrations', () => {
  it("run in timestamp order across modules, so a module can reference another module's table even if its folder sorts first", async () => {
    write('aaa', '202601020000_notes.sql', 'CREATE TABLE notes (id text PRIMARY KEY, person text REFERENCES people (id));');
    write('zzz', '202601010000_people.sql', 'CREATE TABLE people (id text PRIMARY KEY);');
    expect(await migrate(discoverMigrations(dir))).toEqual(['zzz/202601010000_people.sql', 'aaa/202601020000_notes.sql']);
    expect(await migrate(discoverMigrations(dir))).toEqual([]); // a restart applies nothing twice
  });

  it('a failing migration leaves nothing behind and the fixed version applies on the next start', async () => {
    write('people', '202601010000_people.sql', 'CREATE TABLE people (id text PRIMARY KEY);');
    write('pets', '202601020000_pets.sql', 'CREATE TABLE pets (id text PRIMARY KEY); CREATE TABLE pets (id text);');
    await expect(migrate(discoverMigrations(dir))).rejects.toThrow(/pets\/migrations\/202601020000_pets\.sql failed/);
    expect(await tableExists('people')).toBe(false); // the whole run rolled back, not just the failing file
    expect(await tableExists('_migrations')).toBe(false);

    write('pets', '202601020000_pets.sql', 'CREATE TABLE pets (id text PRIMARY KEY);');
    expect(await migrate(discoverMigrations(dir))).toHaveLength(2);
  });

  it('an applied migration that was edited stops startup, but a CRLF checkout of the same file does not', async () => {
    write('people', '202601010000_people.sql', 'CREATE TABLE people (\n  id text PRIMARY KEY\n);\n');
    await migrate(discoverMigrations(dir));
    write('people', '202601010000_people.sql', 'CREATE TABLE people (\r\n  id text PRIMARY KEY\r\n);\r\n');
    expect(await migrate(discoverMigrations(dir))).toEqual([]);
    write('people', '202601010000_people.sql', 'CREATE TABLE people (\n  id text PRIMARY KEY,\n  name text\n);\n');
    await expect(migrate(discoverMigrations(dir))).rejects.toThrow(/was edited after it was applied/);
  });
});

describe('tx', () => {
  it('a transaction that fails halfway leaves none of its writes, while reads inside it (through any repo) see them', async () => {
    await exec('CREATE TABLE t (id int PRIMARY KEY)');
    let seenInside = -1;
    await expect(
      tx(async () => {
        await query('INSERT INTO t VALUES (1)');
        // A module-level read inside the transaction joins it (on PGlite it would otherwise wait
        // for the transaction to end: a deadlock).
        seenInside = (await one<{ n: number }>('SELECT count(*)::int AS n FROM t'))!.n;
        await query('INSERT INTO t VALUES (1)'); // duplicate key
      }),
    ).rejects.toMatchObject({ code: '23505' });
    expect(seenInside).toBe(1);
    expect((await one<{ n: number }>('SELECT count(*)::int AS n FROM t'))!.n).toBe(0);
  });

  it('work scheduled inside a transaction that runs after it committed uses the pool, not the finished transaction', async () => {
    await exec('CREATE TABLE t (id int PRIMARY KEY)');
    let later!: Promise<unknown>;
    await tx(async () => {
      await query('INSERT INTO t VALUES (1)');
      later = new Promise((resolve, reject) => setTimeout(() => query('INSERT INTO t VALUES (2)').then(resolve, reject), 20));
    });
    await later;
    expect((await query<{ id: number }>('SELECT id FROM t ORDER BY id')).map((r) => r.id)).toEqual([1, 2]);
  });
});
