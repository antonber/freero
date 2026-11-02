// Restoring card notes the card toolbar wiped (cardNotes.ts, admin cards:restore-notes): real
// boards and versions in in-memory Postgres, written through the server's consumer the way the
// running server does it.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { BoardElement, CardElement } from '@freero/shared';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import realtimeAdmin from './admin';
import { CARD_NOTES_CONSUMER, cardNotesConsumer, requestNotesRestore } from './cardNotes';
import * as repo from './repo';
import { changeBoard, initBoardDoc, readBoardView, snapshotBoardDoc } from './rooms';

let userId: string;
const HOUR = 3_600_000;

beforeAll(async () => {
  await openTestDb({ FREERO_DOC_IDLE_MS: '100' });
  userId = (await createUser({ name: 'Dana', email: 'notes@test.freero.app', password: 'password-123' })).id;
  registerOutboxConsumer(cardNotesConsumer);
});
afterAll(() => closeTestDb());

let z = 0;
const base = (id: string, type: string, x: number, y: number, w: number, h: number) => ({ id, type, x, y, w, h, rotation: 0, z: ++z, createdBy: 'mcp', createdAt: 1, updatedAt: 1 });
const card = (id: string, title: string, description: string, x: number, y: number, h: number, frameId?: string) =>
  ({ ...base(id, 'card', x, y, 260, h), title, description, color: '#5B3FF0', status: null, assigneeId: null, dueDate: '2026-11-13', tags: [], ...(frameId ? { frameId } : {}) }) as unknown as BoardElement;
// A two-column kanban at the origin: column 0's items start at y = 52 + 44 + 10 = 106, x = 22.
const kanban = (h: number) =>
  ({ ...base('k', 'kanban', 0, 0, 596, h), title: 'Pipeline', colW: 280, columns: [{ id: 'c1', title: 'Active deal' }, { id: 'c2', title: 'Pass' }] }) as unknown as BoardElement;

async function boardWith(elements: BoardElement[]): Promise<string> {
  const board = await createBoard(userId, 'Deals', '');
  const doc = new Y.Doc();
  for (const e of elements) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  return board.id;
}
/** Keeps the board as it is now as a version taken at `at`. */
async function version(boardId: string, at: number): Promise<void> {
  await repo.insertSnapshot(boardId, { state: (await snapshotBoardDoc(boardId))!, kind: 'auto', name: null, createdBy: null }, at);
}
const edit = (boardId: string, update: Array<{ id: string; patch: Record<string, unknown> }>, remove: string[] = []) =>
  changeBoard(boardId, { userId, role: 'owner' }, () => ({ change: { update, remove } }));
const els = async (boardId: string) => new Map((await readBoardView(boardId, { userId, role: 'owner' })).elements.map((e) => [e.el.id, e.el]));
/** What --apply does: ask for the restore, and the server's consumer runs it. */
async function apply(boardId: string, since: number) {
  await requestNotesRestore(boardId, since);
  await drainOutbox(CARD_NOTES_CONSUMER);
}

const NOTES = 'Owner: Dana<br>Lead: Sam<br>Next: send <b>term sheet</b>';

it('a card a click wiped gets the newest notes a version had, exactly as stored, and the cards below it in its column move back down', async () => {
  const now = Date.now();
  const boardId = await boardWith([kanban(394), card('acme', 'Acme Corp', 'Owner: Dana', 22, 106, 119, 'k'), card('globex', 'Globex', 'Owner: Lee', 22, 235, 119, 'k')]);
  await version(boardId, now - 3 * HOUR);
  await edit(boardId, [{ id: 'acme', patch: { description: NOTES, h: 137 } }, { id: 'globex', patch: { y: 253 } }]);
  await version(boardId, now - 2 * HOUR);
  // The wipe as a client wrote it: empty notes, the card re-measured shorter, its column re-stacked.
  await edit(boardId, [{ id: 'acme', patch: { description: '', h: 79 } }, { id: 'globex', patch: { y: 195 } }, { id: 'k', patch: { h: 336 } }]);
  await version(boardId, now - HOUR); // a version taken after the wipe must not hide the notes

  await apply(boardId, now - 4 * HOUR);
  const after = await els(boardId);
  const acme = after.get('acme') as CardElement;
  expect(acme.description).toBe(NOTES);
  expect(acme.h).toBe(137);
  expect(after.get('globex')!.y).toBe(253);
  expect(after.get('k')!.h).toBe(394); // holds the column again: 52 + 44 + (372 - 106) + 2 * 10 + 12

  // Running it again finds nothing to do.
  const state = await snapshotBoardDoc(boardId);
  await apply(boardId, now - 4 * HOUR);
  expect(await snapshotBoardDoc(boardId)).toEqual(state);
});

it('a card someone wrote new notes on since, and a card deleted since, are left as they are', async () => {
  const now = Date.now();
  const boardId = await boardWith([card('a', 'Initech', NOTES, 0, 0, 137), card('b', 'Umbrella', 'Owner: Kim', 400, 0, 119)]);
  await version(boardId, now - 2 * HOUR);
  await edit(boardId, [{ id: 'a', patch: { description: 'Rewritten by hand' } }], ['b']);

  await apply(boardId, now - 3 * HOUR);
  const after = await els(boardId);
  expect((after.get('a') as CardElement).description).toBe('Rewritten by hand');
  expect(after.has('b')).toBe(false);
});

it('a card that never had notes since the bug stays empty, even if it had some before', async () => {
  const now = Date.now();
  const boardId = await boardWith([card('old', 'Hooli', 'Cleared on purpose last month', 0, 0, 119), card('never', 'Pied Piper', '', 400, 0, 79)]);
  await version(boardId, now - 5 * HOUR); // before `since`
  await edit(boardId, [{ id: 'old', patch: { description: '' } }]);
  await version(boardId, now - 2 * HOUR);

  await apply(boardId, now - 4 * HOUR);
  const after = await els(boardId);
  expect((after.get('old') as CardElement).description).toBe('');
  expect((after.get('never') as CardElement).description).toBe('');
});

it('a dry run changes nothing and prints card titles, never the notes', async () => {
  const now = Date.now();
  const boardId = await boardWith([card('acme', 'Acme Corp', NOTES, 0, 0, 137)]);
  await version(boardId, now - 2 * HOUR);
  await edit(boardId, [{ id: 'acme', patch: { description: '' } }]);
  const before = await snapshotBoardDoc(boardId);

  const lines: string[] = [];
  const [cmd] = realtimeAdmin();
  await cmd.run({ positional: [], flags: { board: boardId, since: new Date(now - 3 * HOUR).toISOString().slice(0, 10) }, print: (l) => lines.push(l) });
  const out = lines.join('\n');
  expect(out).toContain(`card acme "Acme Corp"`);
  expect(out).not.toMatch(/Owner|Lead|term sheet/);
  // Nothing written, and nothing queued for the server to write.
  await drainOutbox(CARD_NOTES_CONSUMER);
  expect(await snapshotBoardDoc(boardId)).toEqual(before);
});
