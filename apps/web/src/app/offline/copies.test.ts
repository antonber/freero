// Offline copies on the device (#178): what is kept, for whom, and when it goes.
import { beforeEach, expect, it } from 'vitest';
import type { Account, BoardSummary } from '@freero/shared';
import { offlineAccount, offlineBoard, offlineHostFor, offlineSignedIn, offlineSignedOut, setVaultForTests } from './copies';
import { memoryBackend, OfflineVault } from './vault';

let backend: ReturnType<typeof memoryBackend>;
let vault: OfflineVault;
beforeEach(() => {
  backend = memoryBackend();
  vault = new OfflineVault(backend);
  setVaultForTests(vault);
});

const person = (id: string): Account => ({ id, name: id, email: `${id}@test.freero.app`, color: '#1C7ED6', avatarUrl: null, emailVerified: true, timeZone: null, deletionScheduledFor: null }) as Account;
const board = (id: string, offline: boolean | null = true): BoardSummary =>
  ({ id, kind: 'board', title: `Board ${id}`, role: 'editor', permissions: { canExport: true, canShareExternally: true, maxLinkAccess: 'editor', canMove: true, canTransfer: true, ...(offline === null ? {} : { offline }) } }) as BoardSummary;
const words = (s: string) => new TextEncoder().encode(s);
const keep = async (user: Account, b: BoardSummary, text = 'secret plan') => offlineHostFor(user, { board: b, team: null })!.save({ shared: words(text) });

it('a board whose workspace forbids offline copies (or a server that doesn’t say) is never stored, and a copy kept earlier is deleted', async () => {
  const ana = person('ana');
  await keep(ana, board('b1'));
  expect(await offlineBoard(ana.id, 'b1')).not.toBeNull();

  expect(offlineHostFor(ana, { board: board('b1', false), team: null })).toBeUndefined();
  expect(offlineHostFor(ana, { board: board('b2', null), team: null })).toBeUndefined();
  await new Promise((r) => setTimeout(r, 0));
  expect(await vault.boardIds()).toEqual([]);
});

it('on the next online start, boards the person lost access to are wiped from the device and the others stay', async () => {
  const ana = person('ana');
  await keep(ana, board('kept'));
  await keep(ana, board('revoked'));
  await offlineSignedIn(ana, async (ids) => ({ keep: ids.filter((id) => id !== 'revoked') }));
  expect(await offlineBoard(ana.id, 'kept')).not.toBeNull();
  expect(await offlineBoard(ana.id, 'revoked')).toBeNull();
  expect(await vault.boardIds()).toEqual(['kept']);
});

it('signing out wipes everything, and a board still closing afterwards can’t write a new copy', async () => {
  const ana = person('ana');
  const host = offlineHostFor(ana, { board: board('b1'), team: null })!;
  await host.save({ shared: words('before') });
  await offlineSignedOut();
  expect(backend.raw.size).toBe(0);
  expect(await offlineAccount()).toBeNull();

  await host.save({ shared: words('the tab closing after sign-out') });
  expect(backend.raw.size).toBe(0);
});

it('someone else signing in on the device can’t read the previous person’s boards: their copies are wiped', async () => {
  const ana = person('ana');
  await keep(ana, board('b1'));
  await offlineSignedIn(person('ben'), async (ids) => ({ keep: ids }));
  expect(await offlineBoard('ben', 'b1')).toBeNull();
  expect(await offlineBoard(ana.id, 'b1')).toBeNull();
  expect(backend.raw.size).toBe(0);
});

it('what the device stores is sealed: no board text or title on disk, and the copy opens again only for its person', async () => {
  const ana = person('ana');
  await keep(ana, board('b1'), 'quarterly numbers');
  const onDisk = JSON.stringify([...backend.raw.values()], (_k, v) => (v instanceof ArrayBuffer || ArrayBuffer.isView(v) ? new TextDecoder().decode(v as ArrayBuffer) : v));
  expect(onDisk).not.toContain('quarterly numbers');
  expect(onDisk).not.toContain('Board b1');
  expect(new TextDecoder().decode((await vault.loadBoard(ana.id, 'b1'))!.copy.shared)).toBe('quarterly numbers');
  expect((await offlineAccount())?.id).toBe('ana');
});
