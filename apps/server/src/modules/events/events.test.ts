// The event stream on real stored boards (in-memory Postgres): changes raise outbox events in
// their own transactions, the consumer records board and membership events, and settled saves are
// compared into item and comment events — once each, whatever the consumer replays.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { Account, BoardElement, ElementDraft } from '@freero/shared';
import { drainOutbox, registerOutboxConsumer } from '../../platform/outbox';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { changeBoard, initBoardDoc, initBoardLayer } from '../realtime/index';
import { eventsOfBoard } from './repo';
import { deriveDueBoards, EVENTS_CONSUMER, eventsConsumer } from './service';

beforeAll(async () => {
  await openTestDb();
  registerOutboxConsumer(eventsConsumer);
});
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@events.test.freero.app`, password: 'password-123' }, { emailVerified: true });
let z = 0;
const el = (id: string, type: string, fields: Record<string, unknown>): BoardElement =>
  ({ id, type, x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, ...fields }) as BoardElement;

/** Lets everything raised so far through the consumer, then compares every board as if it had settled. */
async function settle() {
  await drainOutbox(EVENTS_CONSUMER);
  await deriveDueBoards(Date.now() + 3600_000);
}
const kinds = async (boardId: string) => (await eventsOfBoard(boardId)).map((e) => `${e.type}${e.objectUri.includes('#') ? ` ${e.objectUri.split('#')[1]}` : ''}`);

it('saves before a board settles are one comparison: a sticky created and edited twice is one item.created with its final text; a later edit is one item.updated; hiding it in a frame reads as deleted; a private draft is never an event', async () => {
  const owner = await user('Owner');
  const b = await createBoard(owner.id, 'Plans', '');
  const doc = new Y.Doc();
  doc.getMap('elements').set('s1', el('s1', 'sticky', { text: 'Hello', color: 'yellow', createdBy: owner.id }));
  await initBoardDoc(b.id, Y.encodeStateAsUpdate(doc));
  const actor = { userId: owner.id, role: 'owner' as const };
  for (const text of ['Hello there', 'Hello there, team'])
    await changeBoard(b.id, actor, () => ({ change: { update: [{ id: 's1', patch: { text } }] } }));
  await initBoardLayer(b.id, `u:${owner.id}`, (() => {
    const l = new Y.Doc();
    l.getMap('elements').set('draft', el('draft', 'sticky', { text: 'Secret draft', color: 'yellow' }));
    return Y.encodeStateAsUpdate(l);
  })());
  await settle();
  expect(await kinds(b.id)).toEqual(['board.created', 'item.created s1']);
  const created = (await eventsOfBoard(b.id))[1];
  expect(created.data).toEqual({ item: { id: 's1', type: 'sticky', text: 'Hello there, team' } });
  expect(created.actor).toMatchObject({ kind: 'user', id: owner.id });

  await changeBoard(b.id, actor, () => ({ change: { update: [{ id: 's1', patch: { color: 'blue' } }] } }));
  await settle();
  expect((await kinds(b.id)).slice(2)).toEqual(['item.updated s1']);

  await changeBoard(b.id, actor, () => ({ change: { create: [el('hf', 'frame', { title: 'Later', hidden: true }) as unknown as ElementDraft], update: [{ id: 's1', patch: { frameId: 'hf' } }] } }));
  await settle();
  expect((await kinds(b.id)).slice(3).sort()).toEqual(['item.created hf', 'item.deleted s1']);
  expect(JSON.stringify(await eventsOfBoard(b.id))).not.toContain('Secret draft');
});

it('a membership change is one event even when the consumer dies after recording it and replays the batch', async () => {
  const [owner, guest] = await Promise.all([user('Sharer'), user('Invitee')]);
  const b = await createBoard(owner.id, 'Shared', '');
  await inviteBoardMember(null, b.id, owner, { email: guest.email, role: 'commenter' });
  let calls = 0;
  registerOutboxConsumer({
    ...eventsConsumer,
    async handle(events, ctx) {
      await eventsConsumer.handle(events, ctx);
      if (++calls === 1) throw new Error('killed before the cursor moved');
    },
  });
  await expect(drainOutbox(EVENTS_CONSUMER)).rejects.toThrow('killed');
  await drainOutbox(EVENTS_CONSUMER);
  registerOutboxConsumer(eventsConsumer);
  const members = (await eventsOfBoard(b.id)).filter((e) => e.type === 'member.added');
  expect(members.map((e) => [e.data, e.actor])).toEqual([[{ userId: guest.id, role: 'commenter' }, { kind: 'user', id: owner.id, app: null }]]);
});
