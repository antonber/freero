// Layout from structure, placed on real boards (in-memory Postgres) through the same path the
// REST route uses. (That the write reaches collaborators as one change is realtime's guarantee:
// realtime/view.test.ts.)
import { afterAll, beforeAll, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  rectsOverlap,
  rotatedBounds,
  tableCellKey,
  type BoardElement,
  type ConnectorElement,
  type InsertStructureRequest,
  type Rect,
  type TableElement,
} from '@freero/shared';
import { closeTestDb, openTestDb } from '../../platform/testing';
import { createUser } from '../auth/index';
import { createBoard } from '../boards/index';
import { initBoardDoc, readBoardView, type BoardView } from '../realtime/index';
import { planStructure } from './plan';
import { insertStructure } from './service';

let userId: string;

beforeAll(async () => {
  await openTestDb();
  userId = (await createUser({ name: 'Agent Owner', email: 'structure@test.freero.app', password: 'password-123' })).id;
});
afterAll(() => closeTestDb());

let z = 0;
const sticky = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): BoardElement =>
  ({ id, type: 'sticky', x, y, w: 200, h: 200, rotation: 0, z: ++z, createdBy: 'someone', createdAt: 1, updatedAt: 1, text: id, color: 'yellow', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle', ...extra }) as BoardElement;

async function boardWith(elements: BoardElement[]): Promise<string> {
  const board = await createBoard(userId, 'Structure', '');
  const doc = new Y.Doc();
  for (const e of elements) doc.getMap('elements').set(e.id, e);
  await initBoardDoc(board.id, Y.encodeStateAsUpdate(doc));
  return board.id;
}

const elementsOf = async (boardId: string) => (await readBoardView(boardId, { userId, role: 'owner' })).elements.map((e) => e.el);
const insert = (boardId: string, req: InsertStructureRequest) => insertStructure(boardId, userId, req);
const overlap = (a: Rect, b: Rect, gap = 0) => rectsOverlap({ x: a.x - gap, y: a.y - gap, w: a.w + 2 * gap, h: a.h + 2 * gap }, b);

it('lays a 12-node / 15-edge graph out with no overlapping shapes, every connector attached at both ends, clear of what was there', async () => {
  const existing = [sticky('a', 0, 0), sticky('b', 260, 0), sticky('c', 0, 260)];
  const boardId = await boardWith(existing);
  const nodes = Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, text: `Step ${i}${i % 3 === 0 ? ' with a longer label to wrap' : ''}` }));
  const pairs = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [0, 5], [2, 8], [11, 3], [4, 9]];
  const res = await insert(boardId, { structure: { kind: 'graph', nodes, edges: pairs.map(([a, b]) => ({ from: `n${a}`, to: `n${b}` })) } });

  const all = await elementsOf(boardId);
  const created = all.filter((e) => res.created.includes(e.id));
  const shapes = created.filter((e) => e.type === 'shape');
  const lines = created.filter((e): e is ConnectorElement => e.type === 'connector');
  expect(shapes).toHaveLength(12);
  expect(lines).toHaveLength(15);
  for (let i = 0; i < shapes.length; i++) for (let j = i + 1; j < shapes.length; j++) expect(overlap(shapes[i], shapes[j])).toBe(false);
  const shapeIds = new Set(shapes.map((s) => s.id));
  for (const c of lines) {
    expect(shapeIds.has(c.start.elementId!)).toBe(true);
    expect(shapeIds.has(c.end.elementId!)).toBe(true);
  }
  // The edges join the nodes they were asked to (by text).
  const text = new Map(shapes.map((s) => [s.id, (s as { text: string }).text.replace(/<br>/g, ' ')]));
  expect(lines.map((c) => `${text.get(c.start.elementId!)!.split(' ')[1]}>${text.get(c.end.elementId!)!.split(' ')[1]}`).sort()).toEqual(pairs.map(([a, b]) => `${a}>${b}`).sort());
  for (const e of existing) expect(overlap(res.bounds, e, 47)).toBe(false);
  // Attributed to the caller.
  expect(new Set(created.map((e) => e.createdBy))).toEqual(new Set([userId]));
});

it('places a structure "near X" beside X on free space and never on top of anything (random boards)', () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  for (let round = 0; round < 150; round++) {
    const els: BoardElement[] = [];
    const n = 5 + Math.floor(rand() * 60);
    for (let i = 0; i < n; i++) els.push(sticky(`s${i}`, Math.round(rand() * 3000), Math.round(rand() * 3000), { w: 80 + Math.round(rand() * 400), h: 80 + Math.round(rand() * 300), rotation: rand() < 0.2 ? 30 : 0 }));
    const x = els[Math.floor(rand() * n)];
    const view: BoardView = { elements: els.map((el) => ({ el, layer: 'shared' })), collection: () => new Map(), seesHidden: true, version: '' };
    let k = 0;
    const plan = planStructure({ structure: { kind: 'stickies', items: ['a', 'b', 'c', 'd', 'e'] }, near: x.id }, view, () => `new${k++}`);
    for (const e of els) expect(overlap(plan.placed.bounds, rotatedBounds(e))).toBe(false);
    for (const d of plan.change.create!) for (const e of els) expect(overlap(d, rotatedBounds(e))).toBe(false);
    // Adjacent when the space right next to X is free.
    const right = { x: x.x + x.w + 48, y: x.y + x.h / 2 - plan.placed.size.h / 2, ...plan.placed.size };
    if (!els.some((e) => overlap(right, rotatedBounds(e), 48))) expect(plan.placed.bounds).toMatchObject({ x: Math.round(right.x), y: Math.round(right.y) });
  }
});

it('turns a Mermaid flowchart with subgraphs into frames that hold their nodes', async () => {
  const boardId = await boardWith([]);
  const res = await insert(boardId, {
    structure: {
      kind: 'mermaid',
      source: [
        'flowchart LR',
        '  start([Start]) --> a',
        '  subgraph backend [Backend]',
        '    a[API] -->|calls| b[(Database)]',
        '    subgraph jobs [Jobs]',
        '      c{{Queue}} -.-> d[Worker]',
        '    end',
        '  end',
        '  b --> c',
        '  d ==> e((Done))',
        '  e -.-> jobs',
      ].join('\n'),
    },
  });
  const all = (await elementsOf(boardId)).filter((e) => res.created.includes(e.id));
  const frames = all.filter((e) => e.type === 'frame') as Array<BoardElement & { title: string }>;
  const outer = frames.find((f) => f.title === 'Backend')!;
  const inner = frames.find((f) => f.title === 'Jobs')!;
  expect(inner.frameId).toBe(outer.id);
  const shapeByText = (t: string) => all.find((e) => e.type === 'shape' && (e as { text: string }).text === t)!;
  const inside = (r: Rect, f: Rect) => r.x >= f.x && r.y >= f.y && r.x + r.w <= f.x + f.w && r.y + r.h <= f.y + f.h;
  for (const t of ['API', 'Database']) {
    expect(shapeByText(t).frameId).toBe(outer.id);
    expect(inside(shapeByText(t), outer)).toBe(true);
  }
  for (const t of ['Queue', 'Worker']) {
    expect(shapeByText(t).frameId).toBe(inner.id);
    expect(inside(shapeByText(t), inner)).toBe(true);
  }
  for (const t of ['Start', 'Done']) {
    expect(shapeByText(t).frameId ?? null).toBe(null);
    expect(overlap(shapeByText(t), outer)).toBe(false);
  }
  expect(shapeByText('Database')).toMatchObject({ shape: 'cylinder' });
  expect(shapeByText('Start')).toMatchObject({ shape: 'terminator' });
  const lines = all.filter((e): e is ConnectorElement => e.type === 'connector');
  expect(lines).toHaveLength(6);
  // A link to a subgraph attaches to its frame.
  expect(lines.find((c) => c.start.elementId === shapeByText('Done').id)!.end.elementId).toBe(inner.id);
  expect(lines.find((c) => c.start.elementId === shapeByText('API').id)).toMatchObject({ label: 'calls', end: { elementId: shapeByText('Database').id } });
  expect(lines.find((c) => c.start.elementId === shapeByText('Queue').id)).toMatchObject({ strokeStyle: 'dashed' });
});

it('refuses malformed structure with a clear error and writes nothing', async () => {
  const boardId = await boardWith([sticky('only', 0, 0)]);
  const cases: Array<[InsertStructureRequest['structure'], RegExp]> = [
    [{ kind: 'graph', nodes: Array.from({ length: 10_000 }, (_, i) => ({ id: `n${i}`, text: 'x' })), edges: [] }, /At most 2000/],
    [{ kind: 'mermaid', source: 'flowchart TD\n  A --> B\n  A ~~~> B {weird' }, /line 3/],
    [{ kind: 'mermaid', source: 'pie title Pets\n "Dogs" : 386' }, /only flowcharts/],
    [{ kind: 'graph', nodes: [{ id: 'a', text: 'A' }], edges: [{ from: 'a', to: 'ghost' }] }, /isn't listed/],
    [{ kind: 'graph', nodes: [{ id: 'a', text: 'A' }], edges: [], groups: [{ id: 'g1', title: 'x', nodes: ['a'], parent: 'g2' }, { id: 'g2', title: 'y', nodes: [], parent: 'g1' }] }, /contain each other/],
    [{ kind: 'clusters', clusters: [{ items: [{ id: 'not-here' }] }] }, /No item not-here/],
    [{ kind: 'orgchart', people: [{ name: 'Ann' }, { name: 'Bo', manager: 'Ghost' }] }, /manager "Ghost" isn't in the list/],
    [{ kind: 'orgchart', people: [{ name: 'Ann', manager: 'Bo' }, { name: 'Bo', manager: 'Ann' }] }, /in a circle/],
    [{ kind: 'mermaid', source: 'mindmap\n  Root\n  Second root' }, /line 3: a mind map has one root/],
  ];
  for (const [structure, message] of cases) await expect(insert(boardId, { structure })).rejects.toMatchObject({ status: 400, message: expect.stringMatching(message) });
  expect((await elementsOf(boardId)).map((e) => e.id)).toEqual(['only']);
});

it('writes a table with its cells, beside the item it was placed near', async () => {
  const boardId = await boardWith([sticky('there', 0, 0)]);
  const res = await insert(boardId, { structure: { kind: 'table', rows: [['Name', 'Owner'], ['Login', 'Ann'], ['Search']] }, near: 'there' });
  const view = await readBoardView(boardId, { userId, role: 'owner' });
  const table = view.elements.find((e) => e.el.id === res.created[0])!.el as TableElement;
  expect(table.x).toBe(200 + 48);
  const cells = view.collection('tableCells');
  const grid = table.rows.map((r) => table.cols.map((c) => cells.get(tableCellKey('t', table.id, r.id, c.id)) ?? ''));
  expect(grid).toEqual([['Name', 'Owner'], ['Login', 'Ann'], ['Search', '']]);
});

it('clusters stickies already on the board: they leave their frame, bring their reaction stamps, and land clear of everything', async () => {
  const frame = { id: 'f', type: 'frame', x: -100, y: -100, w: 900, h: 900, rotation: 0, z: 0, createdBy: 'x', createdAt: 1, updatedAt: 1, title: 'Inbox', fill: '#fff', index: 0 } as BoardElement;
  const stamp = { id: 'stamp', type: 'emoji', x: 150, y: -10, w: 40, h: 40, rotation: 0, z: 99, createdBy: 'x', createdAt: 1, updatedAt: 1, emoji: '👍', attachedTo: 's1', frameId: 'f' } as BoardElement;
  const boardId = await boardWith([frame, sticky('s1', 0, 0, { frameId: 'f' }), sticky('s2', 300, 0, { frameId: 'f' }), sticky('s3', 0, 300, { frameId: 'f' }), stamp]);
  const res = await insert(boardId, { structure: { kind: 'clusters', clusters: [{ title: 'Speed', items: [{ id: 's1' }, 'New idea'] }, { title: 'Quality', items: [{ id: 's2' }, { id: 's3' }] }] } });
  expect(res.moved.sort()).toEqual(['s1', 's2', 's3']);
  const all = new Map((await elementsOf(boardId)).map((e) => [e.id, e]));
  for (const id of ['s1', 's2', 's3']) {
    expect(all.get(id)!.frameId ?? null).toBe(null);
    expect(overlap(all.get(id)!, frame)).toBe(false);
  }
  // The stamp kept its place on its sticky.
  expect({ dx: all.get('stamp')!.x - all.get('s1')!.x, dy: all.get('stamp')!.y - all.get('s1')!.y }).toEqual({ dx: 150, dy: -10 });
});

it('turns an indented outline into a mind map: every node under its parent, no two pills overlapping', async () => {
  const boardId = await boardWith([]);
  const text = ['- Launch', '  - Marketing', '    - Blog post', '    - Webinar with a much longer title than the others', '  - Product', '    - Beta', '  - Sales', '  - Support', '    - Docs', '    - FAQ'].join('\n');
  const res = await insert(boardId, { structure: { kind: 'outline', text } });
  const nodes = (await elementsOf(boardId)).filter((e) => res.created.includes(e.id)) as Array<BoardElement & { text: string; parentId: string | null }>;
  const byText = new Map(nodes.map((n) => [n.text, n]));
  expect(byText.get('Launch')!.parentId).toBe(null);
  expect(byText.get('Blog post')!.parentId).toBe(byText.get('Marketing')!.id);
  expect(byText.get('FAQ')!.parentId).toBe(byText.get('Support')!.id);
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) expect(overlap(nodes[i], nodes[j])).toBe(false);
});

it("lays a sequence diagram out top to bottom, each message between its participants' lifelines", async () => {
  const boardId = await boardWith([]);
  const source = ['sequenceDiagram', '  participant U as User', '  participant A as API', '  actor D as Database', '  U->>A: POST /login', '  A->>D: find user', '  D-->>A: row', '  A->>A: check password', '  A-->>U: 200 + cookie'].join('\n');
  const res = await insert(boardId, { structure: { kind: 'mermaid', source } });
  const all = (await elementsOf(boardId)).filter((e) => res.created.includes(e.id));
  const boxes = new Map(all.filter((e) => e.type === 'shape').map((s) => [(s as { text: string }).text, s]));
  const lifeline = (name: string) => boxes.get(name)!.x + boxes.get(name)!.w / 2;
  const messages = all.filter((e): e is ConnectorElement => e.type === 'connector' && !e.start.elementId);
  expect(messages.map((m) => m.label)).toEqual(['POST /login', 'find user', 'row', 'check password', '200 + cookie']);
  const ys = messages.map((m) => m.start.y);
  expect([...ys].sort((a, b) => a - b)).toEqual(ys);
  expect([messages[0].start.x, messages[0].end.x]).toEqual([lifeline('User'), lifeline('API')]);
  expect([messages[2].start.x, messages[2].end.x, messages[2].strokeStyle]).toEqual([lifeline('Database'), lifeline('API'), 'dashed']);
  // Lifelines hang from every participant.
  expect(all.filter((e): e is ConnectorElement => e.type === 'connector' && !!e.start.elementId)).toHaveLength(3);
});

it('builds a kanban from columns: each card stacked in its column, in order, with the status the column stands for', async () => {
  const boardId = await boardWith([]);
  const res = await insert(boardId, { structure: { kind: 'kanban', title: 'Sprint', columns: [{ title: 'To do', items: ['Login', 'Search'] }, { title: 'In progress', items: ['Billing'] }, { title: 'Ideas', items: [] }, { title: 'Done', items: ['Signup'] }] } });
  const all = (await elementsOf(boardId)).filter((e) => res.created.includes(e.id));
  const board = all.find((e) => e.type === 'kanban') as BoardElement & { colW: number; columns: Array<{ status: string | null }> };
  const cards = all.filter((e) => e.type === 'card') as Array<BoardElement & { title: string; status: string | null }>;
  expect(board.columns.map((c) => c.status)).toEqual(['todo', 'doing', null, 'done']);
  const column = (el: BoardElement) => Math.floor((el.x + el.w / 2 - board.x) / (board.colW + 12));
  const at = (t: string) => cards.find((c) => c.title === t)!;
  expect(['Login', 'Search', 'Billing', 'Signup'].map((t) => [column(at(t)), at(t).frameId, at(t).status])).toEqual([
    [0, board.id, 'todo'],
    [0, board.id, 'todo'],
    [1, board.id, 'doing'],
    [3, board.id, 'done'],
  ]);
  expect(at('Login').y + at('Login').h).toBeLessThan(at('Search').y);
  for (const c of cards) expect(c.y + c.h).toBeLessThanOrEqual(board.y + board.h);
});

it('lays an org chart out as a tree: everyone below their manager, the managers centered over their reports, no boxes overlapping', async () => {
  const boardId = await boardWith([]);
  const people = [
    { name: 'Maria', title: 'CEO' },
    { name: 'Ann', title: 'CTO', manager: 'Maria' },
    { name: 'Bo', title: 'CFO', manager: 'Maria' },
    { name: 'Cy', title: 'Engineer', manager: 'Ann' },
    { name: 'Di', title: 'Engineer', manager: 'Ann' },
    { name: 'Ed', title: 'Designer', manager: 'Ann' },
    { name: 'Flo', title: 'Accountant', manager: 'Bo' },
  ];
  const res = await insert(boardId, { structure: { kind: 'orgchart', people } });
  const all = (await elementsOf(boardId)).filter((e) => res.created.includes(e.id));
  const boxes = new Map(all.filter((e) => e.type === 'shape').map((s) => [/<b>(.*?)<\/b>/.exec((s as { text: string }).text)![1], s]));
  const center = (b: BoardElement) => b.x + b.w / 2;
  for (const p of people.filter((p) => p.manager)) expect(boxes.get(p.name)!.y, p.name).toBeGreaterThan(boxes.get(p.manager!)!.y + boxes.get(p.manager!)!.h);
  const reports = ['Cy', 'Di', 'Ed'].map((n) => boxes.get(n)!);
  expect(Math.abs(center(boxes.get('Ann')!) - (center(reports[0]) + center(reports[2])) / 2)).toBeLessThan(1);
  const list = [...boxes.values()];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) expect(overlap(list[i], list[j])).toBe(false);
  const lines = all.filter((e): e is ConnectorElement => e.type === 'connector');
  expect(lines).toHaveLength(6);
  expect(lines.every((l) => l.start.elementId && l.end.elementId)).toBe(true);
});

it('reads a Mermaid mind map: nesting by indentation, node brackets, icons and classes left out', async () => {
  const boardId = await boardWith([]);
  const source = ['mindmap', '  root((Launch plan))', '    Marketing', '      ::icon(fa fa-book)', '      b1[Blog post]', '      Webinar:::urgent', '    Product', '      Beta)Private beta(', '    %% a comment', '    Sales'].join('\n');
  const res = await insert(boardId, { structure: { kind: 'mermaid', source } });
  const nodes = (await elementsOf(boardId)).filter((e) => res.created.includes(e.id)) as Array<BoardElement & { text: string; parentId: string | null }>;
  const byText = new Map(nodes.map((n) => [n.text, n]));
  expect([...byText.keys()].sort()).toEqual(['Blog post', 'Launch plan', 'Marketing', 'Private beta', 'Product', 'Sales', 'Webinar']);
  expect(byText.get('Launch plan')!.parentId).toBe(null);
  expect(byText.get('Blog post')!.parentId).toBe(byText.get('Marketing')!.id);
  expect(byText.get('Webinar')!.parentId).toBe(byText.get('Marketing')!.id);
  expect(byText.get('Private beta')!.parentId).toBe(byText.get('Product')!.id);
  expect(byText.get('Sales')!.parentId).toBe(byText.get('Launch plan')!.id);
});
