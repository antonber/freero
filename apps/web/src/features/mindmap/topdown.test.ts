// #134: top-down maps and stickies turned into a map, on a real engine board.
import { afterEach, expect, it } from 'vitest';
import { richTextToPlain, type BoardElement, type MindmapElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type TestBoard } from '@engine';
import manifest from './feature';
import mindmapDef from './element';
import { addChild, currentIndex, moveAmongSiblings, newRoot, setDirection } from './lib/actions';
import { mapFromStickies } from './lib/fromStickies';
import { layoutTree } from './lib/layout';
import { indexNodes, type MindNode } from './lib/tree';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

const stickyDef = { type: 'sticky', label: { one: 'Sticky', many: 'Stickies' }, icon: () => null, resize: 'free', defaults: () => ({ type: 'sticky', w: 200, h: 200 }), Component: () => null } as unknown as ElementDefinition;
const open = () => {
  board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [mindmapDef, stickyDef], tools: [], formats: [], panels: [], commands: [] }] });
  return board.editors('mindmap')[0];
};
const overlap = (a: MindNode, b: MindNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

it('a top-down map puts every child below its parent, sibling subtrees side by side without overlapping, in left-to-right order', () => {
  let seq = 0;
  // Positions only encode the intended sibling order (left to right).
  const n = (id: string, parentId: string | null, extra: Partial<MindNode> = {}): MindNode => ({ id, parentId, x: seq * 10, y: 0, w: 120, h: 32, createdAt: seq++, ...extra });
  const nodes = [n('root', null, { w: 180, h: 60, direction: 'down' }), n('a', 'root'), n('a1', 'a'), n('a2', 'a'), n('a3', 'a'), n('b', 'root'), n('c', 'root'), n('c1', 'c'), n('c2', 'c')];
  const pos = layoutTree(indexNodes(nodes), 'root');
  const laid = nodes.map((x) => ({ ...x, ...pos.get(x.id) }));
  const at = (id: string) => laid.find((x) => x.id === id)!;
  for (let i = 0; i < laid.length; i++) for (let j = i + 1; j < laid.length; j++) expect(overlap(laid[i], laid[j]), `${laid[i].id} × ${laid[j].id}`).toBe(false);
  for (const x of laid) if (x.parentId) expect(x.y).toBeGreaterThanOrEqual(at(x.parentId).y + at(x.parentId).h);
  expect(at('a').x).toBeLessThan(at('b').x);
  expect(at('b').x).toBeLessThan(at('c').x);
  expect(at('root')).toMatchObject({ x: 0, y: 0 });
});

it('turning a map top-down and back keeps every topic’s place among its siblings, and a new child goes last', () => {
  const ed = open();
  const root = ed.create(newRoot({ x: 0, y: 0 }))!;
  const child = (parent: string) => {
    addChild(ed, parent);
    ed.stopEditing();
    return ed.getSelection()[0];
  };
  const [k0, k1, k2] = [child(root), child(root), child(root)];
  // Reordered by hand: the order is no longer the order they were made in.
  moveAmongSiblings(ed, k2, -1);
  const kids = [k0, k2, k1];
  const order = () => currentIndex(ed).kids.get(root)!.map((k) => k.id);
  expect(order()).toEqual(kids);

  setDirection(ed, [root], 'down');
  expect(order()).toEqual(kids);
  const r = ed.getElement<MindmapElement>(root)!;
  for (const id of kids) expect(ed.getElement(id)!.y).toBeGreaterThanOrEqual(r.y + r.h);
  const last = child(root);
  expect(order()).toEqual([...kids, last]);

  setDirection(ed, [root], 'right');
  expect(order()).toEqual([...kids, last]);
});

it('“Make a mind map” turns the notes into a map around the chosen one, and one undo puts the notes back', () => {
  const ed = open();
  const note = (text: string, x: number, y: number) => ed.create({ type: 'sticky', x, y, w: 200, h: 200, text: `<p>${text}</p>`, color: 'yellow' } as never)!;
  const ideas = note('Ideas', 300, 0);
  const goal = note('Launch goal', 0, 0);
  const risks = note('Risks', 300, 300);

  const made = mapFromStickies(ed, goal, [ideas, goal, risks]);

  expect(made.length).toBeGreaterThan(0);
  const nodes = ed.getElements().filter((e): e is MindmapElement => e.type === 'mindmap');
  const text = (e: BoardElement) => richTextToPlain((e as MindmapElement).text);
  const centre = nodes.find((e) => !e.parentId)!;
  expect(text(centre)).toBe('Launch goal');
  expect(nodes.filter((e) => e.parentId === centre.id).map(text).sort()).toEqual(['Ideas', 'Risks']);
  expect(ed.getElements().some((e) => e.type === 'sticky')).toBe(false);

  ed.undo();
  expect(ed.getElements().map((e) => e.type).sort()).toEqual(['sticky', 'sticky', 'sticky']);
});
