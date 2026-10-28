// Upgrading a real database across the workspace migrations: data written by the previous release
// (no workspaces yet) must come out with every board in its owner's personal workspace — otherwise
// boards vanish from dashboards or (worse) land where others can see them. Seeds the OLD schema
// with raw rows, which no module code can write any more (see dune.exceptions.json).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeDb, discoverMigrations, migrate, openDb, query } from './db';

const MODULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../modules');
const WORKSPACES_STAMP = '202610291000';

beforeAll(() => openDb({ pgliteDir: 'memory' }));
afterAll(() => closeDb());

it('upgrading a pre-workspace database puts every board (trashed ones too) into its own owner’s personal workspace', async () => {
  const all = discoverMigrations(MODULES_DIR);
  await migrate(all.filter((m) => m.stamp < WORKSPACES_STAMP));
  const t = new Date('2026-10-01T00:00:00Z');
  for (const u of ['ann', 'bob', 'cy'])
    await query(`INSERT INTO users (id, email, name, password_hash, color, created_at) VALUES ($1, $2, $1, 'x', '#000000', $3)`, [u, `${u}@up.test`, t]);
  for (const [id, owner, deleted] of [
    ['b1', 'ann', null],
    ['b2', 'ann', t],
    ['b3', 'bob', null],
  ] as const)
    await query(
      `INSERT INTO boards (id, title, owner_id, created_at, updated_at, deleted_at) VALUES ($1, $1, $2, $3, $3, $4)`,
      [id, owner, t, deleted],
    );

  await migrate(all);

  const boards = await query<{ id: string; owner_id: string; personal_of: string; kind: string }>(
    `SELECT b.id, b.owner_id, w.personal_of, w.kind FROM boards b JOIN workspaces w ON w.id = b.workspace_id ORDER BY b.id`,
  );
  expect(boards).toEqual([
    { id: 'b1', owner_id: 'ann', personal_of: 'ann', kind: 'personal' },
    { id: 'b2', owner_id: 'ann', personal_of: 'ann', kind: 'personal' },
    { id: 'b3', owner_id: 'bob', personal_of: 'bob', kind: 'personal' },
  ]);
  // Everyone — with boards or not — owns exactly their own personal workspace, and nobody else is in it.
  const members = await query<{ user_id: string; role: string; personal_of: string }>(
    `SELECT m.user_id, m.role, w.personal_of FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id ORDER BY m.user_id`,
  );
  expect(members).toEqual(['ann', 'bob', 'cy'].map((u) => ({ user_id: u, role: 'owner', personal_of: u })));
});
