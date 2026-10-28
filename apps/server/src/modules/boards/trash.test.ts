import { afterAll, beforeAll, expect, it } from 'vitest';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createTeamWorkspace, updateWorkspaceSettings } from '../workspaces/index';
import { getBoardAccess } from './index';
import { createBoard, listBoards, moveToTrash, purgeExpiredTrash, restoreFromTrash, TRASH_RETENTION_MS } from './service';

const LIMIT = 3;
const DAY = 86_400_000;

beforeAll(() => openTestDb({ MAX_BOARDS_PER_USER: String(LIMIT) }));
afterAll(() => closeTestDb());

let n = 0;
const user = (name: string) => createUser({ name, email: `${name.toLowerCase()}${++n}@test.freero.app`, password: 'password-123' });

it('parallel creates by one user never land over the board limit', async () => {
  const u = await user('Racer');
  const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createBoard(u.id, `B${i}`, '')));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(LIMIT);
  expect(await listBoards(u.id, 'mine', '')).toHaveLength(LIMIT);
});

it('restoring from the trash cannot take the owner over the board limit (trashed boards free their slot)', async () => {
  const u = await user('Hoarder');
  const boards = [];
  for (let i = 0; i < LIMIT; i++) boards.push(await createBoard(u.id, `B${i}`, ''));
  await moveToTrash(boards[0], u.id);
  await createBoard(u.id, 'Replacement', ''); // the trashed board's slot is free again
  await expect(restoreFromTrash(boards[0].id, u.id)).rejects.toMatchObject({ status: 403 });
  expect((await listBoards(u.id, 'trash', '')).map((b) => b.id)).toEqual([boards[0].id]);
});

it('a trashed board is gone for everyone with access until its owner restores it; nobody else can restore it', async () => {
  const owner = await user('Owner');
  const guest = await user('Guest');
  const board = await createBoard(owner.id, 'Plans', '', 'editor');
  expect((await getBoardAccess(board.id, guest.id)).role).toBe('editor');

  await moveToTrash(board, board.ownerId, 1_000_000);
  // getBoardAccess is what admits board sockets: a trashed board admits nobody, owner included.
  expect((await getBoardAccess(board.id, guest.id)).exists).toBe(false);
  expect((await getBoardAccess(board.id, owner.id)).exists).toBe(false);
  expect(await listBoards(owner.id, 'all', '')).toEqual([]);
  expect(await listBoards(guest.id, 'trash', '')).toEqual([]);
  const [trashed] = await listBoards(owner.id, 'trash', '');
  expect(trashed).toMatchObject({ id: board.id, deletedAt: 1_000_000, purgeAt: 1_000_000 + TRASH_RETENTION_MS });

  await expect(restoreFromTrash(board.id, guest.id)).rejects.toMatchObject({ status: 404 });
  await restoreFromTrash(board.id, owner.id);
  expect((await getBoardAccess(board.id, guest.id)).role).toBe('editor'); // sharing survives the trash
  expect(await listBoards(owner.id, 'trash', '')).toEqual([]);
});

it('the purge deletes only boards past the retention period, and replicas purging at once do it exactly once', async () => {
  const owner = await user('Purger');
  const now = Date.now();
  const old = await createBoard(owner.id, 'Old', '');
  const recent = await createBoard(owner.id, 'Recent', '');
  await moveToTrash(old, old.ownerId, now - 31 * DAY);
  await moveToTrash(recent, recent.ownerId, now - 29 * DAY);

  const purged = await Promise.all([purgeExpiredTrash(now), purgeExpiredTrash(now)]);
  expect(purged[0] + purged[1]).toBe(1);
  await expect(restoreFromTrash(old.id, owner.id)).rejects.toMatchObject({ status: 404 });
  await restoreFromTrash(recent.id, owner.id);
  expect((await listBoards(owner.id, 'mine', '')).map((b) => b.title)).toEqual(['Recent']);
});

it('a workspace’s shorter trash retention purges its boards sooner (and says so in the trash), leaving other workspaces at the default', async () => {
  const owner = await user('Tidy');
  const team = await createTeamWorkspace(owner.id, 'Tidy team');
  await updateWorkspaceSettings(team.id, owner.id, { trashRetentionDays: 7 });
  const now = Date.now();
  const teamBoard = await createBoard(owner.id, 'Team', '', 'none', { workspaceId: team.id });
  const personal = await createBoard(owner.id, 'Mine', '');
  await moveToTrash(teamBoard, owner.id, now - 8 * DAY);
  await moveToTrash(personal, owner.id, now - 8 * DAY);
  const [inTrash] = await listBoards(owner.id, 'trash', '', { workspaceId: team.id });
  expect(inTrash.purgeAt).toBe(now - 8 * DAY + 7 * DAY);

  expect(await purgeExpiredTrash(now)).toBe(1);
  expect((await listBoards(owner.id, 'trash', '', { workspaceId: team.id })).length).toBe(0);
  expect((await listBoards(owner.id, 'trash', '')).map((b) => b.title)).toEqual(['Mine']);
});
