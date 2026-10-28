import { describe, expect, it } from 'vitest';
import type { MindmapElement } from '@freero/shared';
import { createTestBoard } from '@engine';
import manifest from './feature';
import mindmapDef from './element';
import { addChild, currentIndex, moveAmongSiblings, navigateFrom, newRoot, promote } from './lib/actions';
import { layoutTree } from './lib/layout';
import { planFollow } from './lib/follow';
import { computeInfo, indexNodes, type Direction, type MindNode } from './lib/tree';

let seq = 0;
function node(id: string, parentId: string | null, h = 32, extra: Partial<MindNode> = {}): MindNode {
  // Initial positions only encode intended sibling order (top to bottom).
  return { id, parentId, x: 0, y: seq++ * 10, w: 120, h, createdAt: seq, ...extra };
}

/** root → a(a1 tall, a2, a3) · b · c(c1(c1x, c1y), c2) */
function sampleMap(direction: Direction = 'right'): MindNode[] {
  seq = 0;
  return [
    node('root', null, 60, { w: 180, direction }),
    node('a', 'root'),
    node('a1', 'a', 90),
    node('a2', 'a'),
    node('a3', 'a'),
    node('b', 'root', 50),
    node('c', 'root'),
    node('c1', 'c'),
    node('c1x', 'c1', 70),
    node('c1y', 'c1'),
    node('c2', 'c'),
  ];
}

function apply(nodes: MindNode[], pos: Map<string, { x: number; y: number }>): MindNode[] {
  return nodes.map((n) => ({ ...n, ...(pos.get(n.id) ?? {}) }));
}

const overlap = (a: MindNode, b: MindNode) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const byId = (nodes: MindNode[], id: string) => nodes.find((n) => n.id === id)!;

describe('mind-map layout', () => {
  it.each<Direction>(['right', 'left', 'both'])('never overlaps nodes of sibling subtrees (%s)', (dir) => {
    let nodes = sampleMap(dir);
    // 'both' splits first-level branches by side of the root: put b on the left.
    if (dir === 'both') nodes = nodes.map((n) => (n.id === 'b' ? { ...n, x: -500 } : n));
    const laid = apply(nodes, layoutTree(indexNodes(nodes), 'root'));
    for (let i = 0; i < laid.length; i++)
      for (let j = i + 1; j < laid.length; j++) expect(overlap(laid[i], laid[j]), `${laid[i].id} × ${laid[j].id}`).toBe(false);
    // Children sit beside their parent on the map's side, never on top of it.
    for (const n of laid) {
      if (!n.parentId) continue;
      const p = byId(laid, n.parentId);
      expect(n.x >= p.x + p.w || n.x + n.w <= p.x).toBe(true);
    }
    expect(byId(laid, 'root')).toMatchObject({ x: 0, y: 0 });
  });

  it('keeps the order users dragged siblings into, so a drop above a sibling reorders', () => {
    const nodes = sampleMap();
    const laid = apply(nodes, layoutTree(indexNodes(nodes), 'root'));
    // Drag c (last branch) above a (first branch).
    const dragged = laid.map((n) => (n.id === 'c' ? { ...n, y: byId(laid, 'a').y - 40 } : n));
    const relaid = apply(dragged, layoutTree(indexNodes(dragged), 'root'));
    expect(byId(relaid, 'c').y).toBeLessThan(byId(relaid, 'a').y);
    expect(byId(relaid, 'a').y).toBeLessThan(byId(relaid, 'b').y);
    // c's children came along with it.
    expect(byId(relaid, 'c1').y).toBeLessThan(byId(relaid, 'a').y);
  });

  it('frees a collapsed branch’s space and parks its hidden nodes behind it', () => {
    const nodes = sampleMap();
    const open = apply(nodes, layoutTree(indexNodes(nodes), 'root'));
    const closed = open.map((n) => (n.id === 'a' ? { ...n, collapsed: true } : n));
    const relaid = apply(closed, layoutTree(indexNodes(closed), 'root'));
    const a = byId(relaid, 'a');
    // Siblings close up: b is now right under a.
    expect(byId(relaid, 'b').y - (a.y + a.h)).toBeLessThan(byId(open, 'b').y - (byId(open, 'a').y + byId(open, 'a').h));
    for (const id of ['a1', 'a2', 'a3']) {
      const h = byId(relaid, id);
      expect(h.x + h.w / 2).toBeCloseTo(a.x + a.w / 2, 0);
      expect(h.y + h.h / 2).toBeCloseTo(a.y + a.h / 2, 0);
    }
  });
});

describe('which nodes are hidden (not rendered, not clickable)', () => {
  it('hides everything under a collapsed node and nodes whose parent was deleted', () => {
    const nodes = sampleMap().map((n) => (n.id === 'c1' ? { ...n, collapsed: true } : n));
    const withoutA = nodes.filter((n) => n.id !== 'a'); // deleted alone from the context menu
    const info = computeInfo(indexNodes(withoutA));
    expect(info.get('c1')!.hidden).toBe(false);
    expect(info.get('c1x')!.hidden).toBe(true);
    expect(info.get('c1y')!.hidden).toBe(true);
    expect(info.get('a1')!.hidden).toBe(true);
    expect(info.get('c2')!.hidden).toBe(false);
  });
});

describe('follow (local changes, same transaction)', () => {
  const laidOut = () => {
    const nodes = sampleMap();
    return apply(nodes, layoutTree(indexNodes(nodes), 'root'));
  };
  const base = { removed: new Set<string>(), previousRoot: () => 'root' };

  it('carries a dragged branch with its node and leaves its siblings where they are', () => {
    const before = laidOut();
    const moved = before.map((n) => (n.id === 'c' ? { ...n, x: n.x + 300, y: n.y + 120 } : n));
    const plan = planFollow({ ...base, nodes: moved, changed: new Set(['c']), selected: new Set(['c']), dragging: true });
    for (const id of ['c1', 'c1x', 'c1y', 'c2']) {
      expect(plan.get(id)!.x - byId(before, id).x).toBeCloseTo(300, 0);
      expect(plan.get(id)!.y - byId(before, id).y).toBeCloseTo(120, 0);
    }
    for (const id of ['root', 'a', 'a1', 'b']) expect(plan.has(id)).toBe(false);
    expect(plan.has('c')).toBe(false); // the dragged node stays under the pointer
  });

  it('re-lays out the map when a node grows while typing, so it never covers its neighbour', () => {
    const before = laidOut();
    const grown = before.map((n) => (n.id === 'a2' ? { ...n, h: 140 } : n));
    const plan = planFollow({ ...base, nodes: grown, changed: new Set(['a2']), selected: new Set(['a2']), dragging: false });
    const after = apply(grown, plan);
    for (const n of after) if (n.id !== 'a2') expect(overlap(n, byId(after, 'a2')), n.id).toBe(false);
  });

  it('closes the gap when a node is deleted outside the mind-map commands', () => {
    const before = laidOut().filter((n) => n.id !== 'b');
    const plan = planFollow({ ...base, nodes: before, changed: new Set(), removed: new Set(['b']), selected: new Set(), dragging: false });
    const after = apply(before, plan);
    const a = byId(after, 'a');
    const c = byId(after, 'c');
    expect(byId(after, 'a3').y + byId(after, 'a3').h).toBeLessThan(byId(after, 'c1x').y);
    expect(c.y).toBeLessThan(byId(before, 'c').y); // c moved up into b's old slot
    expect(a.y).toBeGreaterThan(byId(before, 'a').y); // and the map stays centered on the root
  });
});

describe('keyboard: walking and reshaping the tree', () => {
  const laid = () => {
    const nodes = sampleMap();
    return indexNodes(apply(nodes, layoutTree(indexNodes(nodes), 'root')));
  };

  it('arrows go to the parent, into the middle child, and between siblings on the same side', () => {
    const index = laid();
    expect(navigateFrom(index, 'root', 'ArrowRight')).toBe('b'); // the child level with the root
    // a's children lay out a2, a3, a1 (sample order by position); a3 is level with a.
    expect(navigateFrom(index, 'a', 'ArrowRight')).toBe('a3');
    expect(navigateFrom(index, 'a3', 'ArrowLeft')).toBe('a');
    expect(navigateFrom(index, 'a3', 'ArrowDown')).toBe('a1');
    expect(navigateFrom(index, 'a', 'ArrowDown')).toBe('b');
    expect(navigateFrom(index, 'b', 'ArrowUp')).toBe('a');
    expect(navigateFrom(index, 'c', 'ArrowDown')).toBeNull(); // last sibling: stays
    expect(navigateFrom(index, 'root', 'ArrowLeft')).toBeNull(); // nothing on the left
  });

  it('on a two-sided map, Left from a left-side node goes deeper and Right goes back to its parent', () => {
    seq = 0;
    const nodes = [node('root', null, 60, { w: 180, direction: 'both' }), { ...node('r', 'root'), x: 400 }, { ...node('l', 'root'), x: -500 }, { ...node('l1', 'l'), x: -800 }];
    const index = indexNodes(apply(nodes, layoutTree(indexNodes(nodes), 'root')));
    expect(navigateFrom(index, 'root', 'ArrowLeft')).toBe('l');
    expect(navigateFrom(index, 'l', 'ArrowLeft')).toBe('l1');
    expect(navigateFrom(index, 'l', 'ArrowRight')).toBe('root');
  });

  it('Shift+Tab moves a node (with its branch) up a level, right after its old parent, in one undo step', () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [mindmapDef], tools: [], formats: [], panels: [], commands: [] }] });
    try {
      const [ed] = board.editors('mindmap');
      const root = ed.create(newRoot({ x: 0, y: 0 }));
      const child = (parent: string) => {
        addChild(ed, parent);
        ed.stopEditing();
        return ed.getSelection()[0];
      };
      const a = child(root);
      const b = child(root);
      const g = child(a);
      const gg = child(g);
      promote(ed, g);
      const kids = currentIndex(ed).kids.get(root)!.map((k) => k.id);
      expect(kids).toEqual([a, g, b]);
      expect(ed.getElement<MindmapElement>(gg)!.parentId).toBe(g);
      ed.undo();
      expect(ed.getElement<MindmapElement>(g)!.parentId).toBe(a);
    } finally {
      board.destroy();
    }
  });

  it('Alt+Up / Alt+Down reorder a node among its siblings', () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [mindmapDef], tools: [], formats: [], panels: [], commands: [] }] });
    try {
      const [ed] = board.editors('mindmap');
      const root = ed.create(newRoot({ x: 0, y: 0 }));
      const ids = [0, 1, 2].map(() => {
        addChild(ed, root);
        ed.stopEditing();
        return ed.getSelection()[0];
      });
      moveAmongSiblings(ed, ids[2], -1);
      expect(currentIndex(ed).kids.get(root)!.map((k) => k.id)).toEqual([ids[0], ids[2], ids[1]]);
      moveAmongSiblings(ed, ids[0], 1);
      expect(currentIndex(ed).kids.get(root)!.map((k) => k.id)).toEqual([ids[2], ids[0], ids[1]]);
    } finally {
      board.destroy();
    }
  });

  it("a selected topic leaves Mod+Alt+Up/Down to bring forward / send backward instead of reordering siblings (KAI-202)", () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [mindmapDef], tools: [], formats: [], panels: [], commands: [] }] });
    try {
      const [ed] = board.editors('mindmap');
      const root = ed.create(newRoot({ x: 0, y: 0 }));
      const ids = [0, 1].map(() => {
        addChild(ed, root);
        ed.stopEditing();
        return ed.getSelection()[0];
      });
      ed.select([ids[1]]);
      const press = (mods: Partial<KeyboardEvent>) =>
        mindmapDef.onKeyDown!({ key: 'ArrowUp', altKey: true, shiftKey: false, ctrlKey: false, metaKey: false, ...mods } as KeyboardEvent, { editor: ed, selection: [ed.getElement(ids[1])!] });
      const order = () => currentIndex(ed).kids.get(root)!.map((k) => k.id);
      expect(press({ ctrlKey: true })).toBe(false);
      expect(press({ metaKey: true })).toBe(false);
      expect(order()).toEqual(ids);
      expect(press({})).toBe(true);
      expect(order()).toEqual([ids[1], ids[0]]);
    } finally {
      board.destroy();
    }
  });
});
