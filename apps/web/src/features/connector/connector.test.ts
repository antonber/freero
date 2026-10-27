import { describe, expect, it } from 'vitest';
import type { BoardElement, ConnectorElement, ConnectorEndpoint } from '@freero/shared';
import connectorDef from './element';
import { computeRoute, resolveEnds, type End } from './lib/geometry';
import { refreshCache } from './lib/model';
import { nextToSide } from './lib/quick';

const box = (id: string, x: number, y: number, extra: Partial<BoardElement> = {}): BoardElement =>
  ({ id, type: 'sticky', x, y, w: 100, h: 100, rotation: 0, z: 0, ...extra }) as BoardElement;

const conn = (start: ConnectorEndpoint, end: ConnectorEndpoint, extra: Partial<ConnectorElement> = {}): ConnectorElement =>
  ({
    id: 'c',
    type: 'connector',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    z: 1,
    start,
    end,
    routing: 'straight',
    stroke: '#000',
    strokeWidth: 2,
    strokeStyle: 'solid',
    startCap: 'none',
    endCap: 'arrow',
    label: '',
    ...extra,
  }) as ConnectorElement;

const lookupOf = (...els: BoardElement[]) => (id: string) => els.find((e) => e.id === id);
const close = (a: { x: number; y: number }, b: { x: number; y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 3);
  expect(a.y).toBeCloseTo(b.y, 3);
};

describe('attached endpoints', () => {
  it("an 'auto' end switches to the side facing the other item when that item moves around it", () => {
    const a = box('a', 0, 0);
    const c = conn({ elementId: 'a', anchor: 'auto', x: 0, y: 0 }, { elementId: 'b', anchor: 'auto', x: 0, y: 0 });
    const right = resolveEnds(c, lookupOf(a, box('b', 400, 0)));
    expect([right.start.side, right.end.side]).toEqual(['right', 'left']);
    const below = resolveEnds(c, lookupOf(a, box('b', 0, 400)));
    expect([below.start.side, below.end.side]).toEqual(['bottom', 'top']);
    close(below.start.p, { x: 50, y: 100 });
  });

  it('anchors and their exit direction follow a rotated item', () => {
    // Rotated 90° clockwise around its center (50, 50): its "top" side now faces right.
    const a = box('a', 0, 0, { rotation: 90 });
    const c = conn({ elementId: 'a', anchor: 'top', x: 0, y: 0 }, { x: 500, y: 50 });
    const { start } = resolveEnds(c, lookupOf(a));
    close(start.p, { x: 100, y: 50 });
    close(start.dir!, { x: 1, y: 0 });
  });

  it('deleting an attached item leaves the end as a free point where it last was', () => {
    const c = conn({ elementId: 'a', anchor: 'right', x: 100, y: 50 }, { x: 400, y: 50 });
    const patch = refreshCache(c, lookupOf(), undefined, new Set(['a']));
    expect(patch?.start).toEqual({ x: 100, y: 50 });
  });

  it('bends travel with the line when both connected items are moved together, not when one is', () => {
    const c = conn(
      { elementId: 'a', anchor: 'right', x: 100, y: 50 },
      { elementId: 'b', anchor: 'left', x: 300, y: 50 },
      { routing: 'curved', waypoints: [{ x: 250, y: -80 }] },
    );
    const both = refreshCache(c, lookupOf(box('a', 30, 20), box('b', 330, 20)));
    expect(both?.waypoints).toEqual([{ x: 280, y: -60 }]);
    const one = refreshCache(c, lookupOf(box('a', 30, 20), box('b', 300, 0)));
    expect(one?.waypoints).toBeUndefined();
  });
});

describe('routing', () => {
  const end = (p: { x: number; y: number }, dir: { x: number; y: number }, b: BoardElement): End => ({
    p,
    dir,
    box: { x: b.x, y: b.y, w: b.w, h: b.h },
    side: null,
  });

  it('elbow lines leave and enter perpendicular to their sides and never cut through either connected item', () => {
    // Start on the RIGHT of A, end on the LEFT of B, but B sits to the left of and below A:
    // the route has to go around both items.
    const a = box('a', 300, 0);
    const b = box('b', 0, 200);
    const s = end({ x: 400, y: 50 }, { x: 1, y: 0 }, a);
    const e = end({ x: 0, y: 250 }, { x: -1, y: 0 }, b);
    const { poly } = computeRoute('elbow', s, e);
    const seg = (i: number) => ({ x: poly[i + 1].x - poly[i].x, y: poly[i + 1].y - poly[i].y });
    expect(Math.sign(seg(0).x)).toBe(1);
    expect(seg(0).y).toBe(0);
    const last = seg(poly.length - 2);
    expect(Math.sign(last.x)).toBe(1); // arrives moving right, into B's left side
    expect(last.y).toBe(0);
    for (let i = 0; i < poly.length - 1; i++) {
      const [p, q] = [poly[i], poly[i + 1]];
      expect(p.x === q.x || p.y === q.y).toBe(true);
      for (const r of [a, b]) {
        const crosses =
          Math.max(p.x, q.x) > r.x + 0.5 && Math.min(p.x, q.x) < r.x + r.w - 0.5 &&
          Math.max(p.y, q.y) > r.y + 0.5 && Math.min(p.y, q.y) < r.y + r.h - 0.5;
        expect(crosses).toBe(false);
      }
    }
  });

  it('curved lines leave and enter perpendicular to their sides', () => {
    const a = box('a', 0, 0);
    const b = box('b', 300, 300);
    const route = computeRoute('curved', end({ x: 50, y: 100 }, { x: 0, y: 1 }, a), end({ x: 300, y: 350 }, { x: -1, y: 0 }, b));
    close(route.startTangent, { x: 0, y: -1 }); // first handle points straight down out of A's bottom
    close(route.endTangent, { x: 1, y: 0 }); // arrives moving right into B's left side
  });
});

describe('hit-testing', () => {
  it('a click in the empty corner of a diagonal line misses; a click on the line hits', () => {
    const c = conn({ x: 0, y: 0 }, { x: 300, y: 300 });
    Object.assign(c, refreshCache(c, lookupOf()));
    const local = (x: number, y: number) => ({ x: x - c.x, y: y - c.y });
    expect(connectorDef.hitTest!(c, local(290, 10), { tolerance: 4 })).toBe(false);
    expect(connectorDef.hitTest!(c, local(152, 148), { tolerance: 4 })).toBe(true);
  });
});

describe('quick-connect copies', () => {
  it('fan out sideways instead of landing on an item already sitting there', () => {
    const a = box('a', 0, 0);
    const first = nextToSide(a, 'right', []);
    expect(first.y).toBe(0);
    expect(first.x).toBeGreaterThan(100);
    const taken = [{ x: first.x, y: 0, w: 100, h: 100 }];
    const second = nextToSide(a, 'right', taken);
    expect(second.x).toBe(first.x);
    expect(Math.abs(second.y)).toBeGreaterThanOrEqual(100);
  });
});
