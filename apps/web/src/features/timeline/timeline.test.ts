import { afterEach, describe, expect, it } from 'vitest';
import type { CardElement, TimelineBarElement, TimelineElement } from '@freero/shared';
import { createTestBoard, type Editor, type ElementDefinition, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import defs from './element';
import { addLane, removeLane, setRange, setView } from './lib/actions';
import { addDays, dayOf } from './lib/dates';
import { BAR_H, HORIZON_W, LABEL_W, STUB_W, dayX, gridOf, laneAt } from './lib/layout';

// A stand-in for features/card: cards keep one writer, which the timeline asks through
// `card.setDates` (a feature can't import another, even in tests).
const cardStandIn: FeatureBundle = {
  manifest: { name: 'card', description: 'test stand-in' },
  elements: [{ type: 'card', Component: () => null, defaults: () => ({ type: 'card', w: 280, h: 100 }), resize: 'width-only' } as unknown as ElementDefinition],
  tools: [],
  formats: [],
  panels: [],
  commands: [
    {
      id: 'card.setDates',
      label: 'Set dates',
      run(editor, args) {
        const { id, startDate, dueDate } = args as { id: string; startDate: string; dueDate: string };
        editor.update(id, { startDate, dueDate } as never);
      },
    },
  ],
};
const bundle: FeatureBundle = { manifest, elements: defs, tools: [], formats: [], panels: [], commands: [] };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

function setup(users = ['ann']): Editor[] {
  board = createTestBoard({ users, features: [bundle, cardStandIn] });
  return board.editors('timeline');
}

const T0 = '2026-11-02'; // a Monday
function makeTimeline(ed: Editor, scale: TimelineElement['scale'] = 'week'): string {
  const lanes = [
    { id: 'a', title: 'Design', color: '#E9E4FF', rows: 2 },
    { id: 'b', title: 'Build', color: '#DDF0FF', rows: 2 },
  ];
  const fields = { title: 'Plan', start: T0, end: addDays(T0, 55), scale, lanes };
  return ed.create({ type: 'timeline', x: 0, y: 0, ...fields, ...(({ w, h }) => ({ w, h }))(gridOf(fields)) } as never);
}

function makeBar(ed: Editor, tid: string, start: string, end: string, lane = 0): string {
  const t = ed.getElement<TimelineElement>(tid)!;
  const g = gridOf(t);
  return ed.create({
    type: 'timelinebar',
    title: 'Bar',
    color: '#5B3FF0',
    start,
    end,
    x: t.x + dayX(g, dayOf(start)),
    y: t.y + g.laneTops[lane] + 10,
    w: (dayOf(end) - dayOf(start) + 1) * g.ppd,
    h: BAR_H,
    frameId: tid,
  } as never);
}

/** A pointer drag: one gesture, like the select tool's. */
function drag(ed: Editor, id: string, dx: number, dy = 0) {
  ed.beginGesture();
  ed.moveBy([{ id, dx: dx / 2, dy: dy / 2 }]);
  ed.moveBy([{ id, dx: dx / 2, dy: dy / 2 }]);
  ed.endGesture();
}

const laneOf = (ed: Editor, tid: string, id: string) => {
  const t = ed.getElement<TimelineElement>(tid)!;
  const el = ed.getElement(id)!;
  return t.lanes[laneAt(gridOf(t), el.y + el.h / 2 - t.y)].id;
};

describe('timeline', () => {
  it('dragging a bar by one week moves its start and end by exactly 7 days, as one undo step', () => {
    const [ed] = setup();
    const tid = makeTimeline(ed);
    const id = makeBar(ed, tid, '2026-11-04', '2026-11-10');
    const x0 = ed.getElement(id)!.x;
    const ppd = gridOf(ed.getElement<TimelineElement>(tid)!).ppd;
    // A little off the day grid, as a hand would drop it.
    drag(ed, id, 7 * ppd + 3);
    const bar = ed.getElement<TimelineBarElement>(id)!;
    expect([bar.start, bar.end]).toEqual(['2026-11-11', '2026-11-17']);
    expect(bar.x).toBe(x0 + 7 * ppd);

    ed.undo();
    const back = ed.getElement<TimelineBarElement>(id)!;
    expect([back.start, back.end, back.x]).toEqual(['2026-11-04', '2026-11-10', x0]);
  });

  it('dragging a bar’s right edge changes only its end date', () => {
    const [ed] = setup();
    const tid = makeTimeline(ed);
    const id = makeBar(ed, tid, '2026-11-04', '2026-11-10');
    const ppd = gridOf(ed.getElement<TimelineElement>(tid)!).ppd;
    ed.beginGesture();
    ed.update(id, { w: ed.getElement(id)!.w + 3 * ppd });
    ed.endGesture();
    const bar = ed.getElement<TimelineBarElement>(id)!;
    expect([bar.start, bar.end]).toEqual(['2026-11-04', '2026-11-13']);
  });

  it('narrowing the date range keeps bars at their dates: one past the end shrinks to a stub at the edge, and comes back whole', () => {
    const [ed] = setup();
    const tid = makeTimeline(ed);
    const late = makeBar(ed, tid, '2026-12-10', '2026-12-14');
    const early = makeBar(ed, tid, '2026-11-03', '2026-11-05', 1);
    setRange(ed, tid, { end: '2026-11-30' });
    const t = ed.getElement<TimelineElement>(tid)!;
    const stub = ed.getElement<TimelineBarElement>(late)!;
    expect([stub.start, stub.end]).toEqual(['2026-12-10', '2026-12-14']);
    expect(stub.frameId).toBe(tid);
    expect(stub.w).toBe(STUB_W);
    expect(stub.x + stub.w).toBeCloseTo(t.x + t.w);
    // The other bar didn't move with the edge.
    expect(ed.getElement(early)!.x).toBe(t.x + dayX(gridOf(t), dayOf('2026-11-03')));

    setRange(ed, tid, { end: '2026-12-31' });
    const t2 = ed.getElement<TimelineElement>(tid)!;
    const whole = ed.getElement<TimelineBarElement>(late)!;
    expect(whole.x).toBe(t2.x + dayX(gridOf(t2), dayOf('2026-12-10')));
    expect(whole.w).toBe(5 * gridOf(t2).ppd);
  });

  it('a task card dropped on a lane becomes a bar ending on its due date; dragging the bar’s end moves the card’s due date', () => {
    const [ed] = setup();
    const tid = makeTimeline(ed);
    const cid = ed.create({ type: 'card', x: 3000, y: 0, w: 280, h: 100, title: 'Ship it', description: '', color: '#5B3FF0', status: 'doing', dueDate: '2026-11-20' } as never);
    const t = ed.getElement<TimelineElement>(tid)!;
    const g = gridOf(t);
    const c0 = ed.getElement(cid)!;
    // Dropped with its center over the second lane.
    drag(ed, cid, t.x + LABEL_W + 300 - (c0.x + c0.w / 2), t.y + g.laneTops[1] + 30 - (c0.y + c0.h / 2));
    let card = ed.getElement<CardElement>(cid)!;
    expect(card.frameId).toBe(tid);
    expect(laneOf(ed, tid, cid)).toBe('b');
    expect(card.dueDate).toBe('2026-11-20');
    expect(card.h).toBe(BAR_H);
    expect(card.x + card.w).toBeCloseTo(t.x + dayX(g, dayOf('2026-11-21')));
    expect(card.startDate).toBeTruthy();

    ed.beginGesture();
    ed.update(cid, { w: card.w + 2 * g.ppd });
    ed.endGesture();
    card = ed.getElement<CardElement>(cid)!;
    expect(card.dueDate).toBe('2026-11-22');
  });

  it('two people moving different bars at the same time both keep their moves', () => {
    const [ann, bob] = setup(['ann', 'bob']);
    const tid = makeTimeline(ann);
    const a = makeBar(ann, tid, '2026-11-04', '2026-11-06');
    const b = makeBar(ann, tid, '2026-11-16', '2026-11-18', 1);
    board!.sync();
    const ppd = gridOf(ann.getElement<TimelineElement>(tid)!).ppd;
    drag(ann, a, 2 * ppd);
    drag(bob, b, -3 * ppd);
    board!.sync();
    for (const ed of [ann, bob]) {
      expect(ed.getElement<TimelineBarElement>(a)!.start).toBe('2026-11-06');
      expect(ed.getElement<TimelineBarElement>(b)!.start).toBe('2026-11-13');
    }
  });

  it('a bar dropped onto another in its lane takes the next free row instead of covering it, and the lane grows', () => {
    const [ed] = setup();
    const tid = makeTimeline(ed);
    const first = makeBar(ed, tid, '2026-11-04', '2026-11-12');
    const second = makeBar(ed, tid, '2026-11-20', '2026-11-24');
    const h0 = ed.getElement(tid)!.h;
    // Fill the lane's two rows, then drop a third bar over the first.
    const third = makeBar(ed, tid, '2026-11-05', '2026-11-08');
    const ppd = gridOf(ed.getElement<TimelineElement>(tid)!).ppd;
    drag(ed, second, -15 * ppd);
    const rows = new Set([first, second, third].map((id) => ed.getElement(id)!.y));
    expect(rows.size).toBe(3);
    expect(ed.getElement(tid)!.h).toBeGreaterThan(h0);
    expect([first, second, third].every((id) => laneOf(ed, tid, id) === 'a')).toBe(true);
  });

  it('adding and removing lanes carries each bar with its lane; a removed lane’s bars move to a neighbour, dates intact', () => {
    const [ed] = setup();
    const tid = makeTimeline(ed);
    const inB = makeBar(ed, tid, '2026-11-10', '2026-11-12', 1);
    addLane(ed, tid, 0);
    expect(laneOf(ed, tid, inB)).toBe('b');
    removeLane(ed, tid, 'b');
    const bar = ed.getElement<TimelineBarElement>(inB)!;
    expect(bar.frameId).toBe(tid);
    expect([bar.start, bar.end]).toEqual(['2026-11-10', '2026-11-12']);
    expect(ed.getElement<TimelineElement>(tid)!.lanes.some((l) => l.id === laneOf(ed, tid, inB))).toBe(true);
  });

  it('Now / Next / Later: a bar dragged from Now into Next starts on Next’s first day with the same length, and the dates view then shows it there', () => {
    board = createTestBoard({ users: ['ann'], features: [bundle, cardStandIn], now: () => Date.parse('2026-11-10T12:00:00') });
    const [ed] = board.editors('timeline');
    const tid = makeTimeline(ed);
    const id = makeBar(ed, tid, '2026-11-04', '2026-11-10');
    setView(ed, tid, 'horizons');
    const inNow = ed.getElement(id)!;
    expect(inNow.x).toBeLessThan(LABEL_W + HORIZON_W);
    drag(ed, id, HORIZON_W);
    const bar = ed.getElement<TimelineBarElement>(id)!;
    expect([bar.start, bar.end]).toEqual(['2026-12-01', '2026-12-07']);
    expect(bar.x).toBeGreaterThanOrEqual(LABEL_W + HORIZON_W);
    setView(ed, tid, 'dates');
    const t = ed.getElement<TimelineElement>(tid)!;
    expect(ed.getElement(id)!.x).toBe(t.x + dayX(gridOf(t), dayOf('2026-12-01')));
  });
});
