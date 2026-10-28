// Task-card notifications (KAI-135): from realtime's trusted card events, settled per card, and
// due-date reminders re-checked against the board.
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { ElementDraft, User } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser, markEmailVerified } from '../auth/index';
import { createBoard } from '../boards/index';
import { changeBoard, type CardAssignmentEvent } from '../realtime/index';
import { flushCardNotifications, onCardAssignment, sendDueReminders } from './cards';
import { listFor } from './service';

beforeAll(() => openTestDb({ FREERO_DOC_IDLE_MS: '100' }));
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300));
  await closeTestDb();
});

let n = 0;
async function person(label: string): Promise<User> {
  const email = `${label.toLowerCase()}-${++n}@cards.test.freero.app`;
  const u = await createUser({ name: label, email, password: 'password-123' });
  await markEmailVerified(u.id, email);
  return u;
}
const inbox = async (u: User) => (await listFor(u.id)).notifications;
const change = (e: Partial<CardAssignmentEvent> & Pick<CardAssignmentEvent, 'boardId' | 'actorId'>): CardAssignmentEvent => ({
  elementId: 'card1',
  title: 'Write the brief',
  assigneeId: null,
  previousAssigneeId: null,
  dueDate: null,
  previousDueDate: null,
  removed: false,
  ...e,
});

it('clicking through assignees (Ann, Bob, Ann) notifies Ann once and Bob never; assigning yourself notifies nobody', async () => {
  const [lead, ann, bob] = [await person('Lead'), await person('Ann'), await person('Bob')];
  const board = await createBoard(lead.id, 'Sprint', '', 'editor');
  onCardAssignment(change({ boardId: board.id, actorId: lead.id, assigneeId: ann.id }));
  onCardAssignment(change({ boardId: board.id, actorId: lead.id, previousAssigneeId: ann.id, assigneeId: bob.id }));
  onCardAssignment(change({ boardId: board.id, actorId: lead.id, previousAssigneeId: bob.id, assigneeId: ann.id }));
  onCardAssignment(change({ boardId: board.id, elementId: 'card2', actorId: bob.id, assigneeId: bob.id }));
  await flushCardNotifications();

  const got = await inbox(ann);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ type: 'card.assigned', actor: { id: lead.id }, link: `/board/${board.id}?item=card1` });
  expect(await inbox(bob)).toHaveLength(0);
});

it('a card due tomorrow reminds its assignee once — and not once it was reassigned on the board', async () => {
  const [lead, ann, bob] = [await person('Lead'), await person('Ann'), await person('Bob')];
  const board = await createBoard(lead.id, 'Launch', '', 'editor');
  const now = Date.UTC(2026, 9, 28, 9);
  const card = (id: string, assigneeId: string) =>
    ({ id, x: 0, y: 0, w: 300, h: 90, rotation: 0, type: 'card', title: 'Ship it', description: '', color: '#5B3FF0', status: 'todo', assigneeId, dueDate: '2026-10-29', tags: [] }) as unknown as ElementDraft;
  await changeBoard(board.id, { userId: lead.id, role: 'owner' }, () => ({ change: { create: [card('due1', ann.id), card('due2', bob.id)] } }));
  for (const [id, who] of [['due1', ann], ['due2', bob]] as const)
    onCardAssignment(change({ boardId: board.id, elementId: id, actorId: lead.id, assigneeId: who.id, dueDate: '2026-10-29' }));
  await flushCardNotifications();
  // Someone hands Bob's card to Ann in a way no event reported (another instance, a restore).
  await changeBoard(board.id, { userId: lead.id, role: 'owner' }, () => ({ change: { update: [{ id: 'due2', patch: { assigneeId: ann.id } }] } }));
  const before = (await inbox(ann)).length;

  await sendDueReminders(now);
  await sendDueReminders(now + 3_600_000);
  const reminders = (await inbox(ann)).filter((x) => x.type === 'card.due_soon');
  expect((await inbox(ann)).length - before).toBe(1);
  expect(reminders).toHaveLength(1);
  expect(reminders[0].link).toBe(`/board/${board.id}?item=due1`);
  expect((await inbox(bob)).filter((x) => x.type === 'card.due_soon')).toHaveLength(0);
});
