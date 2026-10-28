import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardElement, SwimlaneElement } from '@freero/shared';
import { createTestBoard, type Editor, type ElementDefinition, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import swimlaneDef from './element';
import { moveBand, newSwimlane, resizeBand, setVertical } from './lib/actions';
import { FIT_PAD, gridOf, placements } from './lib/layout';

const sticky = { type: 'sticky', Component: () => null, defaults: () => ({ type: 'sticky', w: 100, h: 100 }), resize: 'free' } as unknown as ElementDefinition;
const bundle: FeatureBundle = { manifest, elements: [swimlaneDef as unknown as ElementDefinition, sticky], tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
  vi.useRealTimers();
});

function setup(users = ['ann']): Editor[] {
  board = createTestBoard({ users, features: [bundle] });
  return board.editors('swimlane');
}

/** A pointer drag of `id` so its center lands on `to`: one gesture, like the select tool's. */
function drag(ed: Editor, id: string, to: { x: number; y: number }) {
  const el = ed.getElement(id)!;
  ed.beginGesture();
  ed.moveBy([{ id, dx: to.x - (el.x + el.w / 2), dy: to.y - (el.y + el.h / 2) }]);
  ed.endGesture();
}

/** World center of lane i (rows), a little right of its header. */
function inLane(p: SwimlaneElement, i: number, dy = 0) {
  const g = gridOf(p);
  return { x: p.x + g.phaseStarts[0] + 200, y: p.y + g.laneStarts[i] + p.lanes[i].size / 2 + dy };
}

const laneOf = (p: SwimlaneElement, all: BoardElement[], id: string) => placements(p, all).find((pl) => pl.el.id === id)?.lane;

describe('swimlanes', () => {
  it('a shape dropped in lane 2 joins the pool; making lane 1 taller moves it down as much; one undo takes back both', () => {
    const [ed] = setup();
    const pid = ed.create(newSwimlane({ x: 0, y: 0 }));
    const pool = () => ed.getElement<SwimlaneElement>(pid)!;
    const sid = ed.create({ type: 'sticky', x: 2000, y: 0 } as never);
    drag(ed, sid, inLane(pool(), 1));
    expect(ed.getElement(sid)!.frameId).toBe(pid);
    expect(laneOf(pool(), ed.getElements(), sid)).toBe(1);
    const y0 = ed.getElement(sid)!.y;

    // The lane 1 edge dragged 80 px down, in steps like a pointer drag.
    const lane1 = pool().lanes[0];
    ed.beginGesture();
    for (const d of [20, 50, 80]) resizeBand(ed, pid, 'lanes', lane1.id, lane1.size + d);
    ed.endGesture();
    expect(pool().lanes[0].size).toBe(lane1.size + 80);
    expect(ed.getElement(sid)!.y).toBe(y0 + 80);
    expect(laneOf(pool(), ed.getElements(), sid)).toBe(1);

    ed.undo();
    expect(pool().lanes[0].size).toBe(lane1.size);
    expect(ed.getElement(sid)!.y).toBe(y0);
  });

  it('reordering lanes takes their items along, each keeping its place inside its lane', () => {
    const [ed] = setup();
    const pid = ed.create(newSwimlane({ x: 0, y: 0 }));
    const pool = () => ed.getElement<SwimlaneElement>(pid)!;
    const a = ed.create({ type: 'sticky', x: 2000, y: 0 } as never);
    const b = ed.create({ type: 'sticky', x: 2000, y: 400 } as never);
    drag(ed, a, inLane(pool(), 0, -10));
    drag(ed, b, inLane(pool(), 1, 20));
    const offsetIn = (id: string) => placements(pool(), ed.getElements()).find((pl) => pl.el.id === id)!.laneOffset;
    const [oa, ob] = [offsetIn(a), offsetIn(b)];
    const [l0, l1] = pool().lanes;
    moveBand(ed, pid, 'lanes', l0.id, 1);
    expect(pool().lanes.map((l) => l.id).slice(0, 2)).toEqual([l1.id, l0.id]);
    expect(laneOf(pool(), ed.getElements(), a)).toBe(1);
    expect(laneOf(pool(), ed.getElements(), b)).toBe(0);
    expect([offsetIn(a), offsetIn(b)]).toEqual([oa, ob]);
  });

  it('a lane grows to fit an item dropped across its bottom edge, and the next lane’s items move down with it', () => {
    const [ed] = setup();
    const pid = ed.create(newSwimlane({ x: 0, y: 0 }));
    const pool = () => ed.getElement<SwimlaneElement>(pid)!;
    const below = ed.create({ type: 'sticky', x: 2000, y: 0 } as never);
    drag(ed, below, inLane(pool(), 1));
    const belowY = ed.getElement(below)!.y;
    const big = ed.create({ type: 'sticky', x: 2000, y: 600, w: 100, h: 180 } as never);
    // Its center is in lane 1, its bottom 60 px into lane 2.
    const g = gridOf(pool());
    const lane1End = pool().y + g.laneStarts[0] + pool().lanes[0].size;
    drag(ed, big, { x: inLane(pool(), 0).x + 200, y: lane1End + 60 - 90 });
    const grownBy = pool().lanes[0].size - 200;
    expect(grownBy).toBe(60 + FIT_PAD);
    expect(ed.getElement(below)!.y).toBe(belowY + grownBy);
    expect(laneOf(pool(), ed.getElements(), big)).toBe(0);
    expect(laneOf(pool(), ed.getElements(), below)).toBe(1);
  });

  it('turning the lanes into columns keeps every item in its lane', () => {
    const [ed] = setup();
    const pid = ed.create(newSwimlane({ x: 0, y: 0 }));
    const pool = () => ed.getElement<SwimlaneElement>(pid)!;
    const ids = [0, 1, 2].map((i) => {
      const id = ed.create({ type: 'sticky', x: 3000, y: 0 } as never);
      drag(ed, id, inLane(pool(), i));
      return id;
    });
    setVertical(ed, pid, true);
    expect(gridOf(pool()).laneAxis).toBe('x');
    expect(ids.map((id) => laneOf(pool(), ed.getElements(), id))).toEqual([0, 1, 2]);
    for (const id of ids) expect(ed.getElement(id)!.frameId).toBe(pid);
  });

  it('two people dropping items into the same lane at once both keep their items inside it after sync', () => {
    vi.useFakeTimers();
    const [ann, bob] = setup(['ann', 'bob']);
    const pid = ann.create(newSwimlane({ x: 0, y: 0 }));
    const a = ann.create({ type: 'sticky', x: 3000, y: 0, w: 100, h: 150 } as never);
    const b = ann.create({ type: 'sticky', x: 3300, y: 0, w: 300, h: 80 } as never);
    board!.sync();
    vi.advanceTimersByTime(60_000);
    const pool = (ed: Editor) => ed.getElement<SwimlaneElement>(pid)!;
    /** Where lane 1 ends (down) and the pool's phase ends (right), in the world. */
    const ends = (p: SwimlaneElement) => {
      const g = gridOf(p);
      return { y: p.y + g.laneStarts[0] + p.lanes[0].size, x: p.x + g.phaseEnd };
    };
    const outside = (ed: Editor, id: string) => {
      const el = ed.getElement(id)!;
      const e = ends(pool(ed));
      return el.y + el.h > e.y || el.x + el.w > e.x;
    };
    // Ann drops across the bottom of lane 1 (the lane grows), Bob across its right end at the
    // same time (the phase grows): the pool is one value, so the merge keeps only one growth.
    drag(ann, a, inLane(pool(ann), 0, 60));
    drag(bob, b, { x: ends(pool(bob)).x - 60, y: inLane(pool(bob), 0).y });
    board!.sync();
    expect([a, b].some((id) => outside(ann, id))).toBe(true);
    vi.advanceTimersByTime(2000);
    board!.sync();
    for (const ed of [ann, bob])
      for (const id of [a, b]) {
        expect(ed.getElement(id)!.frameId).toBe(pid);
        expect(laneOf(pool(ed), ed.getElements(), id)).toBe(0);
        expect(outside(ed, id)).toBe(false);
      }
    expect(JSON.stringify(pool(ann))).toBe(JSON.stringify(pool(bob)));
  });
});
