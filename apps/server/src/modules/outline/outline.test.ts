// The board outline against real stored boards (in-memory Postgres), read through realtime's
// viewer-aware view and the web features' own outline.ts declarations.
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  buildOutline,
  estimateTokens,
  renderOutlineMarkdown,
  selectOutline,
  tableCellKey,
  type BoardElement,
  type BoardOutline,
  type OutlineItem,
  type Role,
} from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { changeBoard, initBoardDoc, initBoardLayer, readBoardView } from '../realtime/index';
import { outlineFeatures } from './features';
import { boardOutline } from './service';

let owner: { id: string; name: string };
let other: { id: string; name: string };

beforeAll(async () => {
  await openTestDb();
  owner = await createUser({ name: 'Maria', email: 'maria@outline.test.freero.app', password: 'password-123' });
  other = await createUser({ name: 'Ann', email: 'ann@outline.test.freero.app', password: 'password-123' });
});
afterAll(() => closeTestDb());

let z = 0;
function el(type: BoardElement['type'], id: string, x: number, y: number, w: number, h: number, extra: Record<string, unknown> = {}): BoardElement {
  return { id, type, x, y, w, h, rotation: 0, z: ++z, createdBy: owner.id, createdAt: 1, updatedAt: 1, ...extra } as BoardElement;
}
const stickyEl = (id: string, x: number, y: number, text: string, color = 'yellow', extra: Record<string, unknown> = {}) =>
  el('sticky', id, x, y, 200, 200, { text, color, fontFamily: 'sans', fontSize: 'auto', textColor: '#17162B', align: 'center', vAlign: 'middle', ...extra });
const shapeEl = (id: string, x: number, y: number, text: string, shape = 'rect', extra: Record<string, unknown> = {}) =>
  el('shape', id, x, y, 140, 70, { shape, text, fill: '#fff', fillOpacity: 1, stroke: '#000', strokeWidth: 2, strokeStyle: 'solid', fontFamily: 'sans', fontSize: 16, textColor: '#000', align: 'center', vAlign: 'middle', ...extra });
const frameEl = (id: string, x: number, y: number, w: number, h: number, title: string, extra: Record<string, unknown> = {}) =>
  el('frame', id, x, y, w, h, { title, fill: '#fff', index: 0, ...extra });
const link = (id: string, from: string, to: string, label = '') =>
  el('connector', id, 0, 0, 1, 1, {
    start: { elementId: from, x: 0, y: 0 },
    end: { elementId: to, x: 0, y: 0 },
    routing: 'elbow',
    stroke: '#000',
    strokeWidth: 2,
    strokeStyle: 'solid',
    startCap: 'none',
    endCap: 'arrow',
    label,
  });

/** A stored board whose shared doc holds `elements` and `collections`. */
async function boardWith(elements: BoardElement[], collections: Record<string, Record<string, unknown>> = {}, layers: Record<string, BoardElement[]> = {}) {
  const board = await createBoard(owner.id, 'Retro', '');
  const doc = new Y.Doc();
  doc.transact(() => {
    const map = doc.getMap('elements');
    for (const e of elements) map.set(e.id, e);
    for (const [name, entries] of Object.entries(collections)) for (const [k, v] of Object.entries(entries)) doc.getMap(name).set(k, v);
  });
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  for (const [layer, els] of Object.entries(layers)) {
    const l = new Y.Doc();
    for (const e of els) l.getMap('elements').set(e.id, e);
    await initBoardLayer(board.id, layer, Y.encodeStateAsUpdate(l));
  }
  return board.id;
}

/** The outline `who` gets with `role` (the role is resolved by members; here it is given). */
async function outlineAs(boardId: string, who: { id: string }, role: Role): Promise<BoardOutline> {
  const view = await readBoardView(boardId, { userId: who.id, role });
  const names = new Map([owner, other].map((u) => [u.id, u.name]));
  return buildOutline(
    { board: { id: boardId, title: 'Retro' }, version: view.version, readerId: who.id, seesHidden: view.seesHidden, elements: view.elements, collection: view.collection, personName: (id) => names.get(id) },
    await outlineFeatures(),
  );
}

function find(items: OutlineItem[], pred: (i: OutlineItem) => boolean): OutlineItem | undefined {
  for (const i of items) {
    if (pred(i)) return i;
    const hit = find(i.children ?? [], pred);
    if (hit) return hit;
  }
  return undefined;
}
const byId = (o: BoardOutline, id: string) => find(o.items, (i) => i.id === id);
const allIds = (items: OutlineItem[], out: string[] = []) => {
  for (const i of items) {
    out.push(i.id);
    allIds(i.children ?? [], out);
  }
  return out;
};

it('reads a workshop board as frames → clusters → items, with its mind map, kanban, flowchart graph, votes and comments', async () => {
  const flow = ['start', 'check', 'fix', 'test', 'ship', 'done'];
  const elements: BoardElement[] = [
    frameEl('f-ideas', 0, 0, 1400, 900, 'Ideas'),
    // Two colour clusters, far apart inside the frame; a heading above the first.
    el('text', 'h-wins', 40, 40, 400, 30, { text: 'Wins', fontFamily: 'sans', fontSize: 24, textColor: '#000', align: 'left', background: 'transparent', autoWidth: false, frameId: 'f-ideas' }),
    stickyEl('s1', 40, 90, 'Faster deploys', 'yellow', { frameId: 'f-ideas', tags: ['t-infra'] }),
    stickyEl('s2', 264, 90, 'Pairing <b>helped</b>', 'yellow', { frameId: 'f-ideas' }),
    stickyEl('s3', 900, 500, 'Flaky tests', 'pink', { frameId: 'f-ideas' }),
    stickyEl('s4', 1124, 500, 'Slow reviews', 'pink', { frameId: 'f-ideas' }),
    frameEl('f-plan', 0, 1200, 1400, 900, 'Plan'),
    el('kanban', 'k', 40, 1260, 900, 600, {
      title: 'Sprint',
      colW: 280,
      frameId: 'f-plan',
      columns: [
        { id: 'todo', title: 'To do', status: 'todo', color: '#888' },
        { id: 'doing', title: 'Doing', status: 'doing', color: '#888' },
        { id: 'done', title: 'Done', status: 'done', color: '#888' },
      ],
    }),
    // Column 2 starts at 40 + 12 + 292 = 344; a card centered there sits in "Doing".
    el('card', 'c1', 360, 1360, 260, 100, { title: 'Fix login', description: '', color: '#2E9BF0', status: 'doing', dueDate: '2026-11-02', assigneeId: other.id, frameId: 'k' }),
    frameEl('f-flow', 0, 2400, 2400, 600, 'Release flow'),
    ...flow.map((id, i) => shapeEl(id, 40 + i * 380, 2600, id === 'check' ? 'Tests green?' : id, id === 'check' ? 'diamond' : 'rect', { frameId: 'f-flow' })),
    link('e1', 'start', 'check'),
    link('e2', 'check', 'fix', 'no'),
    link('e3', 'fix', 'check', 'retry'),
    link('e4', 'check', 'test', 'yes'),
    link('e5', 'test', 'ship'),
    link('e6', 'ship', 'done'),
    link('e7', 'test', 'fix', 'bug found'),
    // A mind map outside any frame.
    el('mindmap', 'm-root', 3000, 0, 160, 50, { text: 'Product', parentId: null, rootId: 'm-root', color: '#5B3FF0', direction: 'right' }),
    el('mindmap', 'm-a', 3240, -60, 100, 40, { text: 'Growth', parentId: 'm-root', rootId: 'm-root', color: '#f00' }),
    el('mindmap', 'm-a1', 3400, -60, 100, 40, { text: 'Referrals', parentId: 'm-a', rootId: 'm-root', color: '#f00' }),
    el('mindmap', 'm-b', 3240, 60, 100, 40, { text: 'Quality', parentId: 'm-root', rootId: 'm-root', color: '#00f' }),
  ];
  const boardId = await boardWith(elements, {
    tags: { 't-infra': { id: 't-infra', name: 'infra', color: '#000' } },
    voting: {
      session: { id: 'v1', active: false, title: 'Top ideas', votesPerUser: 3, elementIds: null, anonymous: false, startedBy: owner.id, startedAt: 1, endedAt: 2 },
      [`v1:${owner.id}`]: { sessionId: 'v1', userId: owner.id, elementIds: ['s1', 's1', 's3'] },
      [`v1:${other.id}`]: { sessionId: 'v1', userId: other.id, elementIds: ['s1'] },
    },
    comments: {
      't:th1': { kind: 'thread', id: 'th1', x: 0, y: 0, elementId: 's3', createdAt: 5, createdBy: other.id },
      'm:th1:msg1': { kind: 'message', threadId: 'th1', id: 'msg1', authorId: other.id, authorName: 'Ann (old name)', text: `Agree with <@${owner.id}>`, createdAt: 5 },
    },
  });

  const o = await outlineAs(boardId, owner, 'owner');
  expect(o.items.filter((i) => i.kind === 'frame').map((i) => i.title)).toEqual(['Ideas', 'Plan', 'Release flow']);

  // Frames → clusters → items: one cluster per colour group, the heading as the first one's title.
  const ideas = byId(o, 'f-ideas')!;
  const clusters = ideas.children!.filter((c) => c.kind === 'cluster');
  expect(clusters.map((c) => [c.title, c.variant, c.children!.map((s) => s.id)])).toEqual([
    ['Wins', 'yellow', ['s1', 's2']],
    [undefined, 'pink', ['s3', 's4']],
  ]);
  expect(byId(o, 's2')!.text).toBe('Pairing helped');
  expect(byId(o, 's1')).toMatchObject({ votes: 3, tags: ['infra'] });
  expect(byId(o, 's3')!.votes).toBe(1);
  // The comment sits on its item, by the author's current name, the mention resolved.
  expect(byId(o, 's3')!.comments![0].messages[0]).toMatchObject({ author: 'Ann', text: 'Agree with @Maria' });

  // Kanban: columns in order, the card in the column under its center, assignee by name.
  const k = byId(o, 'k')!;
  expect(k.children!.map((c) => c.title)).toEqual(['To do', 'Doing', 'Done']);
  expect(k.children![1].children!.map((c) => c.id)).toEqual(['c1']);
  expect(byId(o, 'c1')!.fields).toMatchObject({ status: 'doing', due: '2026-11-02', assignee: 'Ann' });

  // Mind map: a tree.
  const root = byId(o, 'm-root')!;
  expect(root.children!.map((c) => [c.text, c.children?.map((g) => g.text)])).toEqual([
    ['Growth', ['Referrals']],
    ['Quality', undefined],
  ]);

  // The flowchart: 6 nodes, 7 labelled edges between them.
  const flowNodes = allIds(byId(o, 'f-flow')!.children!).filter((id) => flow.includes(id));
  expect(flowNodes.sort()).toEqual([...flow].sort());
  expect(o.edges).toHaveLength(7);
  expect(o.edges.map((e) => `${e.from}>${e.to}:${e.label ?? ''}`).sort()).toEqual(
    ['start>check:', 'check>fix:no', 'fix>check:retry', 'check>test:yes', 'test>ship:', 'ship>done:', 'test>fix:bug found'].sort(),
  );
  expect(byId(o, 'check')).toMatchObject({ variant: 'diamond', text: 'Tests green?' });
  expect(o.notes.join('\n')).toContain('Top ideas');

  // Outline ids are element ids: an edit addressed to one changes exactly that element.
  await changeBoard(boardId, { userId: owner.id, role: 'owner' }, () => ({ change: { update: [{ id: 's4', patch: { text: 'Slow code reviews' } }] } }));
  const after = await outlineAs(boardId, owner, 'owner');
  const changed = allIds(o.items).filter((id) => JSON.stringify(byId(o, id)) !== JSON.stringify(byId(after, id)));
  // s4 and the cluster holding it, nothing else.
  expect(changed.filter((id) => !id.startsWith('cluster:') && !id.startsWith('f-'))).toEqual(['s4']);
  expect(byId(after, 's4')!.text).toBe('Slow code reviews');
});

it("never shows a reader another user's private drafts, a hidden frame's contents or sealed votes", async () => {
  const boardId = await boardWith(
    [
      frameEl('f-open', 0, 0, 800, 600, 'Open'),
      stickyEl('pub', 40, 40, 'Public idea', 'yellow', { frameId: 'f-open' }),
      frameEl('f-secret', 1000, 0, 800, 600, 'Board offsite', { hidden: true }),
      // In flight to the editors layer: still in the shared doc, inside the hidden frame.
      stickyEl('in-flight', 1040, 300, 'SECRET in flight', 'pink', { frameId: 'f-secret' }),
      link('to-hidden', 'pub', 'hid-1', 'see there'),
    ],
    {
      tableCells: { [tableCellKey('t', 'hid-table', 'r1', 'c1')]: 'SECRET cell' },
      voting: {
        session: { id: 'v2', active: true, title: 'Pick', votesPerUser: 3, elementIds: null, anonymous: true, startedBy: owner.id, startedAt: 1, endedAt: null },
        [`v2:${other.id}`]: { sessionId: 'v2', userId: other.id, elementIds: [], sealed: true },
      },
      comments: {
        't:th9': { kind: 'thread', id: 'th9', x: 0, y: 0, elementId: 'hid-1', createdAt: 5, createdBy: owner.id },
        'm:th9:a': { kind: 'message', threadId: 'th9', id: 'a', authorId: owner.id, authorName: 'Maria', text: 'Looks good', createdAt: 5 },
      },
    },
    {
      editors: [
        stickyEl('hid-1', 1040, 40, 'SECRET hidden sticky', 'yellow', { frameId: 'f-secret' }),
        el('table', 'hid-table', 1300, 40, 160, 44, { rows: [{ id: 'r1', h: 44 }], cols: [{ id: 'c1', w: 160 }], header: false, fontSize: 14, frameId: 'f-secret' }),
        // A frame was just shown: its contents are still in the editors layer until a sweep moves them.
        stickyEl('stale', 2000, 40, 'SECRET not yet moved back'),
      ],
      [`u:${owner.id}`]: [stickyEl('maria-draft', 40, 300, 'SECRET draft of Maria', 'yellow')],
      [`u:${other.id}`]: [stickyEl('ann-draft', 300, 300, 'Ann private draft', 'yellow')],
    },
  );
  const json = (o: BoardOutline) => JSON.stringify(o) + renderOutlineMarkdown(o);

  for (const role of ['viewer', 'commenter'] as const) {
    const o = await outlineAs(boardId, other, role);
    const text = json(o);
    expect(text).not.toContain('SECRET');
    for (const id of ['hid-1', 'hid-table', 'in-flight', 'maria-draft']) expect(text).not.toContain(id);
    expect(byId(o, 'f-secret')).toMatchObject({ hidden: true, withheld: true });
    expect(byId(o, 'f-secret')!.children).toBeUndefined();
    // A thread on a hidden item is withheld with it (KAI-234: saved in the shared doc before the
    // rule, moved to the editors layer when the board loads).
    expect(o.comments).toEqual([]);
    expect(text).not.toContain('Looks good');
    // Ann reads her own drafts (marked private), never anyone else's.
    expect(byId(o, 'ann-draft')).toMatchObject({ private: true });
    expect(o.edges[0]).toMatchObject({ from: 'pub', to: null });
    // Results are hidden while the vote runs.
    expect(text).not.toMatch(/"votes"/);
  }

  // An editor sees the hidden frame's contents, but still not another person's drafts.
  const asEditor = json(await outlineAs(boardId, other, 'editor'));
  expect(asEditor).toContain('SECRET hidden sticky');
  expect(asEditor).toContain('SECRET cell');
  expect(asEditor).toContain('Looks good');
  expect(asEditor).not.toContain('SECRET draft of Maria');
});

it('keeps a 2 000-token budget on a 5 000-item board, says it truncated, and keeps every frame title', async () => {
  const elements: BoardElement[] = [];
  for (let f = 0; f < 10; f++) {
    elements.push(frameEl(`frame-${f}`, f * 6000, 0, 5800, 5800, `Workstream ${f}`));
    for (let i = 0; i < 500; i++) elements.push(stickyEl(`s-${f}-${i}`, f * 6000 + (i % 25) * 230, Math.floor(i / 25) * 230, `Idea ${f}.${i} with a few words of text`, 'yellow', { frameId: `frame-${f}` }));
  }
  const boardId = await boardWith(elements);
  const full = await outlineAs(boardId, owner, 'owner');
  const md = renderOutlineMarkdown(selectOutline(full, { budget: 2000, format: 'markdown' }));
  expect(estimateTokens(md)).toBeLessThanOrEqual(2000);
  for (let f = 0; f < 10; f++) expect(md).toContain(`## Frame "Workstream ${f}"`);
  expect(md).toMatch(/more not shown/);
  const o = selectOutline(full, { budget: 2000, format: 'json' });
  expect(o.meta.truncated).toBe(true);
  expect(estimateTokens(JSON.stringify(o))).toBeLessThanOrEqual(2000);

  // Pages walk every item exactly once; repeats are only context.
  const seen: string[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 100; pages++) {
    const page = selectOutline(full, { limit: 700, cursor });
    const walk = (items: OutlineItem[]) => items.forEach((i) => (i.context ? null : seen.push(i.id), walk(i.children ?? [])));
    walk(page.items);
    cursor = page.meta.nextCursor;
    if (!cursor) break;
  }
  expect(seen.length).toBe(new Set(seen).size);
  expect(new Set(seen)).toEqual(new Set(allIds(full.items)));
});

it('answers "not modified" until something the reader can see changes', async () => {
  const boardId = await boardWith([stickyEl('a', 0, 0, 'One')]);
  const q = { format: 'json' as const, authors: false, comments: true };
  const first = await boardOutline(boardId, owner.id, 'http://x', q);
  if (first === 'not-modified') throw new Error('expected an outline');
  expect(await boardOutline(boardId, owner.id, 'http://x', q, first.outline.version)).toBe('not-modified');
  await changeBoard(boardId, { userId: owner.id, role: 'owner' }, () => ({ change: { update: [{ id: 'a', patch: { text: 'Two' } }] } }));
  expect(await boardOutline(boardId, owner.id, 'http://x', q, first.outline.version)).not.toBe('not-modified');
});
