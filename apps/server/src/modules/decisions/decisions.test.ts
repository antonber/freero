// Decision snapshots (KAI-161) against real stored boards (in-memory Postgres, real live rooms).
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import { formatObjectUri, type Account, type BoardElement } from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard, registerBoardObjectTypes } from '../boards/index';
import { inviteBoardMember } from '../members/index';
import { resolveObjects } from '../objects/index';
import { changeBoard, initBoardDoc, listBoardSnapshots } from '../realtime/index';
import { createDecision, decisionChanges, decisionState, registerDecisionObjects } from './index';

beforeAll(async () => {
  await openTestDb();
  registerBoardObjectTypes();
  registerDecisionObjects();
});
afterAll(() => closeTestDb());

let n = 0;
const user = (label: string): Promise<Account> =>
  createUser({ name: label, email: `${label.toLowerCase()}-${++n}@decisions.test.freero.app`, password: 'password-123' }, { emailVerified: true });

let z = 0;
const el = (id: string, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, type: 'sticky', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: ++z, createdBy: 'x', createdAt: 1, updatedAt: 1, text: '', color: 'yellow', ...extra }) as BoardElement;

async function store(boardId: string, els: BoardElement[]) {
  const doc = new Y.Doc();
  for (const e of els) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(boardId, Y.encodeStateAsUpdate(doc));
}

/** Element ids and texts in a state the server serves. */
function contents(state: Uint8Array): Record<string, string> {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const out: Record<string, string> = {};
  for (const [id, v] of doc.getMap<BoardElement & { text?: string }>('elements')) out[id] = v.text ?? '';
  return out;
}

it('editing the board after a decision never changes what the decision shows, and "what changed" names each difference', async () => {
  const owner = await user('Owner');
  const b = await createBoard(owner.id, 'Pricing', '', 'none');
  await store(b.id, [el('keep', { text: '<p>Keep</p>' }), el('price', { text: '<p>Price: 10</p>' }), el('drop', { text: '<p>Drop me</p>' })]);
  const d = await createDecision(b.id, owner.id, { title: 'Pricing decision', note: 'Agreed with sales' });

  await changeBoard(b.id, { userId: owner.id, role: 'owner' }, () => ({
    change: { update: [{ id: 'price', patch: { text: '<p>Price: 12</p>' } }], remove: ['drop'], create: [el('idea', { x: 300, text: '<p>New idea</p>' }) as never] },
  }));

  expect(contents(await decisionState(d.id, owner.id))).toEqual({ keep: '<p>Keep</p>', price: '<p>Price: 10</p>', drop: '<p>Drop me</p>' });
  const changes = await decisionChanges(d.id, owner.id);
  expect(changes.counts).toEqual({ added: 1, removed: 1, changed: 1, unchanged: 1 });
  expect(changes.changed[0]).toMatchObject({ id: 'price', before: 'Price: 10', text: 'Price: 12' });
  expect(changes.removed[0]).toMatchObject({ id: 'drop', text: 'Drop me' });
  expect(changes.added[0]).toMatchObject({ text: 'New idea' });
});

it('a frame decision holds only that frame’s items and the lines fully inside it — not its neighbours, nor a line leaving it', async () => {
  const owner = await user('Framer');
  const b = await createBoard(owner.id, 'Roadmap', '', 'none');
  const end = (elementId: string) => ({ elementId, x: 0, y: 0 });
  await store(b.id, [
    el('f', { type: 'frame', title: 'Q3', x: 0, y: 0, w: 1000, h: 1000, text: undefined }),
    el('a', { frameId: 'f', text: '<p>A</p>' }),
    el('b', { frameId: 'f', text: '<p>B</p>' }),
    el('outside', { x: 2000, text: '<p>Elsewhere</p>' }),
    el('ab', { type: 'connector', start: end('a'), end: end('b'), text: undefined }),
    el('a-out', { type: 'connector', start: end('a'), end: end('outside'), text: undefined }),
  ]);
  const d = await createDecision(b.id, owner.id, { title: 'Q3 scope', frameId: 'f' });
  expect(d.frameTitle).toBe('Q3');
  expect(Object.keys(contents(await decisionState(d.id, owner.id))).sort()).toEqual(['a', 'ab', 'b', 'f']);
  // Changes outside the frame are not changes of this decision.
  await changeBoard(b.id, { userId: owner.id, role: 'owner' }, () => ({ change: { update: [{ id: 'outside', patch: { text: '<p>Moved on</p>' } }] } }));
  expect((await decisionChanges(d.id, owner.id)).counts).toMatchObject({ added: 0, removed: 0, changed: 0 });
});

it('a hidden frame can’t be frozen (its contents are in no version), and nothing is kept when refused', async () => {
  const owner = await user('Hider');
  const b = await createBoard(owner.id, 'Hidden', '', 'none');
  await store(b.id, [el('h', { type: 'frame', title: 'Secret', hidden: true })]);
  await expect(createDecision(b.id, owner.id, { title: 'Nope', frameId: 'h' })).rejects.toMatchObject({ status: 400 });
  expect((await listBoardSnapshots(b.id)).filter((s) => s.kind === 'decision')).toEqual([]);
});

it('a decision is seen exactly by who may open its board: a viewer reads it, a stranger learns nothing, and only editors make one', async () => {
  const [owner, viewer, stranger] = await Promise.all([user('Lead'), user('Watcher'), user('Stranger')]);
  const b = await createBoard(owner.id, 'Launch', '', 'none');
  await inviteBoardMember(null, b.id, owner, { email: viewer.email, role: 'viewer' });
  await store(b.id, [el('x', { text: '<p>Go</p>' })]);
  const d = await createDecision(b.id, owner.id, { title: 'Go / no-go' });
  const uri = formatObjectUri({ type: 'decision', id: d.id });

  expect((await resolveObjects({ userId: viewer.id }, [uri]))[0]).toMatchObject({ status: 'ok', object: { title: 'Go / no-go', path: `/decision/${d.id}` } });
  expect(contents(await decisionState(d.id, viewer.id))).toEqual({ x: '<p>Go</p>' });
  expect((await resolveObjects({ userId: stranger.id }, [uri]))[0]).toEqual({ uri, status: 'unavailable' });
  await expect(decisionState(d.id, stranger.id)).rejects.toMatchObject({ status: expect.any(Number) });
  await expect(createDecision(b.id, viewer.id, { title: 'Mine' })).rejects.toMatchObject({ status: 403 });
});
