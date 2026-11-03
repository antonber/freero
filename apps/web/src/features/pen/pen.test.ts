import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BoardElement, PenElement } from '@freero/shared';
import { createTestBoard, defineCommands, defineElement, type Editor, type Point, type ToolPointerEvent } from '@engine';
import penElement from './element';
import penTool from './tool';
import { recognise } from './lib/recognise';
import { RECORDED } from './lib/recordedStrokes';
import { buildStroke, capturePressure, constrainAngle, radiusAt, rebakeWidth, simplify, strokeDistance, unpack, type RawPoint } from './lib/stroke';

const recorded = (name: string): Point[] => {
  const flat = RECORDED[name];
  return Array.from({ length: flat.length / 2 }, (_, i) => ({ x: flat[2 * i], y: flat[2 * i + 1] }));
};

function bbox(pts: Point[]) {
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

describe('smart drawing: reading a stroke', () => {
  it('turns sloppy hand-drawn rectangles, ellipses, circles, triangles and diamonds into those shapes where they were drawn', () => {
    const expected = { rectangle: 'rect', ellipse: 'ellipse', circle: 'ellipse', triangle: 'triangle', diamond: 'diamond' } as const;
    for (const [name, shape] of Object.entries(expected)) {
      const pts = recorded(name);
      const r = recognise(pts);
      expect(r, name).toMatchObject({ type: 'shape', shape, rotation: 0 });
      if (r?.type !== 'shape') continue;
      // The clean shape sits on the drawn one: its box matches the stroke's within a few percent.
      const b = bbox(pts);
      const tol = 0.06 * Math.max(b.w, b.h);
      expect(Math.abs(r.x + r.w / 2 - (b.x + b.w / 2)), name).toBeLessThan(tol);
      expect(Math.abs(r.y + r.h / 2 - (b.y + b.h / 2)), name).toBeLessThan(tol);
      expect(Math.abs(r.w - b.w), name).toBeLessThan(2 * tol);
      expect(Math.abs(r.h - b.h), name).toBeLessThan(2 * tol);
      if (name === 'circle') expect(r.w).toBe(r.h);
      // Zoom doesn't change what a drawing is: the same stroke drawn small reads the same.
      expect(recognise(pts.map((p) => ({ x: p.x / 5, y: p.y / 5 }))), `${name} small`).toMatchObject({ type: 'shape', shape });
    }
  });

  it('turns a straight stroke into a line and a stroke ending in a head into an arrow pointing where it was drawn', () => {
    const line = recorded('line');
    const r = recognise(line);
    expect(r).toMatchObject({ type: 'line', arrow: false });
    if (r?.type === 'line') {
      expect(Math.hypot(r.from.x - line[0].x, r.from.y - line[0].y)).toBeLessThan(10);
      // Nearly level: laid exactly level.
      expect(r.to.y).toBe(r.from.y);
    }
    const arrow = recognise(recorded('arrow'));
    expect(arrow).toMatchObject({ type: 'line', arrow: true });
    // Tail where the shaft began (100, 300), head at the tip the barbs hang from (460, 260).
    if (arrow?.type === 'line') {
      expect(Math.hypot(arrow.from.x - 100, arrow.from.y - 300)).toBeLessThan(15);
      expect(Math.hypot(arrow.to.x - 460, arrow.to.y - 260)).toBeLessThan(15);
    }
    // A long shaft with a small head (heads stay the same size however long the arrow is).
    const corners = [{ x: 0, y: 0 }, { x: 600, y: 8 }, { x: 572, y: -14 }, { x: 600, y: 8 }, { x: 574, y: 32 }];
    const long: Point[] = [];
    for (let i = 1; i < corners.length; i++) {
      const [a, b] = [corners[i - 1], corners[i]];
      const n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 5);
      for (let k = 0; k < n; k++) long.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n + Math.sin(long.length * 0.4) });
    }
    expect(recognise(long)).toMatchObject({ type: 'line', arrow: true });
  });

  it('never reads a scribble or a signature as a shape or a line', () => {
    expect(recognise(recorded('scribble'))?.type).toBe('scribble');
    expect(recognise(recorded('signature'))).toBeNull();
  });

  it('leaves strokes smaller than the minimum size as ink', () => {
    const tiny = recorded('rectangle').map((p) => ({ x: p.x / 20, y: p.y / 20 }));
    expect(recognise(tiny, 24)).toBeNull();
  });
});

describe('smart drawing: the pen tool', () => {
  afterEach(() => vi.unstubAllGlobals());

  // Stand-in for the shape feature: its `shape.insert` command makes a plain shape element.
  const shapes = {
    manifest: { name: 'shape', description: 'shape' },
    elements: [defineElement<'shape'>({ type: 'shape', resize: 'free', Component: () => null, defaults: () => ({ type: 'shape', w: 100, h: 100 }) as never })],
    tools: [],
    formats: [],
    panels: [],
    commands: defineCommands([
      { id: 'shape.insert', label: 'Insert', run: (ed, a) => void ed.create({ ...(a as object), type: 'shape', shape: (a as { kind: string }).kind } as never) },
    ]),
  };
  const pen = { manifest: { name: 'pen', description: 'pen' }, elements: [penElement], tools: [penTool], formats: [], panels: [], commands: [] };

  function drawStroke(editor: Editor, pts: Point[]) {
    const ev = (p: Point, button = 0) =>
      ({ editor, point: p, screen: p, shiftKey: false, altKey: false, metaKey: false, button, buttons: 1, pressure: 0.5, pointerType: 'mouse', target: null }) as ToolPointerEvent;
    editor.beginGesture();
    penTool.onPointerDown!(ev(pts[0]));
    for (const p of pts.slice(1)) penTool.onPointerMove!(ev(p, -1));
    penTool.onPointerUp!(ev(pts[pts.length - 1]));
    editor.endGesture();
  }
  const types = (editor: Editor) => editor.getElements().map((el: BoardElement) => el.type);

  it('a recognised rectangle undoes back to the ink first, and a second undo removes the ink', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const board = createTestBoard({ users: ['ann'], features: [pen, shapes] });
    const [ann] = board.editors('pen');
    ann.setToolOptions('pen', { smart: true });
    drawStroke(ann, recorded('rectangle'));
    expect(types(ann)).toEqual(['shape']);
    expect(ann.getElements()[0]).toMatchObject({ shape: 'rect', stroke: '#17162B', fill: 'transparent' });
    ann.undo();
    expect(types(ann)).toEqual(['pen']);
    ann.undo();
    expect(types(ann)).toEqual([]);
    board.destroy();
  });

  it('a scribble erases the items it covers but not a locked one or a big one it only crosses; over nothing it stays ink', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const sticky = defineElement<'sticky'>({ type: 'sticky', resize: 'free', Component: () => null, defaults: () => ({ type: 'sticky', w: 100, h: 100 }) as never });
    const board = createTestBoard({ users: ['ann'], features: [pen, { ...shapes, elements: [...shapes.elements, sticky] as never }] });
    const [ann] = board.editors('pen');
    ann.setToolOptions('pen', { smart: true });
    // The recorded scribble zig-zags over x 300…540, y 300…410.
    const small = ann.create({ type: 'sticky', x: 350, y: 310, w: 100, h: 80 } as never);
    const locked = ann.create({ type: 'sticky', x: 460, y: 320, w: 50, h: 50, locked: true } as never);
    const big = ann.create({ type: 'sticky', x: 100, y: 100, w: 800, h: 600 } as never);
    drawStroke(ann, recorded('scribble'));
    const ids = ann.getElements().map((el) => el.id);
    expect(ids).not.toContain(small);
    expect(ids).toEqual(expect.arrayContaining([locked, big]));
    expect(types(ann)).not.toContain('pen');
    ann.undo();
    expect(ann.getElement(small)).toBeTruthy();
    board.destroy();
    const empty = createTestBoard({ users: ['bob'], features: [pen, shapes] });
    const [bob] = empty.editors('pen');
    bob.setToolOptions('pen', { smart: true });
    drawStroke(bob, recorded('scribble'));
    expect(types(bob)).toEqual(['pen']);
    empty.destroy();
  });

  it('with smart drawing off, a rectangle stays the ink that was drawn', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const board = createTestBoard({ users: ['ann'], features: [pen, shapes] });
    const [ann] = board.editors('pen');
    drawStroke(ann, recorded('rectangle'));
    expect(types(ann)).toEqual(['pen']);
    board.destroy();
  });
});

const line = (from: { x: number; y: number }, to: { x: number; y: number }, n = 50): RawPoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: from.x + ((to.x - from.x) * i) / (n - 1), y: from.y + ((to.y - from.y) * i) / (n - 1), p: 0.5 }));

function stroke(points: RawPoint[], width = 4): PenElement {
  return {
    id: 's',
    type: 'pen',
    rotation: 0,
    z: 1,
    createdBy: 'u',
    createdAt: 0,
    updatedAt: 0,
    stroke: '#000',
    strokeWidth: width,
    highlighter: false,
    ...buildStroke(points, width, false),
  };
}

const local = (el: PenElement, world: { x: number; y: number }) => ({ x: world.x - el.x, y: world.y - el.y });

describe('distance to a pen stroke (hit test + eraser)', () => {
  it('clicking empty space inside a diagonal stroke’s bounding box does not grab the stroke', () => {
    const el = stroke(line({ x: 100, y: 100 }, { x: 300, y: 300 }));
    expect(strokeDistance(el, local(el, { x: 200, y: 200 }))).toBeLessThanOrEqual(0);
    // Bottom-left corner of the bbox: inside the box, far from the ink.
    expect(strokeDistance(el, local(el, { x: 110, y: 290 }))).toBeGreaterThan(100);
  });

  it('the empty middle of a drawn ring is far from the ink, its rim is on it', () => {
    const ring = Array.from({ length: 65 }, (_, i) => {
      const a = (i / 64) * Math.PI * 2;
      return { x: 200 + Math.cos(a) * 100, y: 200 + Math.sin(a) * 100, p: 0.5 };
    });
    const el = stroke(ring);
    expect(strokeDistance(el, local(el, { x: 200, y: 200 }))).toBeGreaterThan(90);
    expect(strokeDistance(el, local(el, { x: 300, y: 200 }))).toBeLessThanOrEqual(0.5);
  });

  it('a stretched stroke is measured where it is drawn now, not where it was before the resize', () => {
    const el = stroke(line({ x: 0, y: 0 }, { x: 200, y: 100 }));
    const wide = { ...el, w: el.w * 2 };
    const mid = local(el, { x: 100, y: 50 }); // middle of the line as drawn
    expect(strokeDistance(wide, { x: mid.x * 2, y: mid.y })).toBeLessThanOrEqual(0);
    expect(strokeDistance(wide, mid)).toBeGreaterThan(10);
  });
});

describe('stroke simplification', () => {
  it('collapses a long straight drag to its endpoints but keeps the corner of a V', () => {
    expect(simplify(line({ x: 0, y: 0 }, { x: 1000, y: 0 }, 500), 0.5)).toHaveLength(2);
    const v = [...line({ x: 0, y: 0 }, { x: 100, y: 100 }), ...line({ x: 100, y: 100 }, { x: 200, y: 0 })];
    const kept = simplify(v, 0.5);
    expect(kept.length).toBeLessThan(6);
    expect(kept.some((p) => p.x === 100 && p.y === 100)).toBe(true);
  });
});

describe('changing stroke width', () => {
  it('keeps a scaled, rotated stroke in place instead of jumping or snapping back to its original size', () => {
    const el = { ...stroke(line({ x: 0, y: 0 }, { x: 200, y: 100 })), rotation: 30 };
    const scaled = { ...el, w: el.w * 1.5, h: el.h * 1.5 };
    const next = { ...scaled, ...rebakeWidth(scaled, 8) };
    const center = (e: PenElement) => ({ x: e.x + e.w / 2, y: e.y + e.h / 2 });
    expect(Math.abs(center(next).x - center(scaled).x)).toBeLessThanOrEqual(1);
    expect(Math.abs(center(next).y - center(scaled).y)).toBeLessThanOrEqual(1);
    // Scale is baked into the points: the line still spans 1.5× its drawn length.
    const pts = unpack(next.points);
    expect(pts[pts.length - 1].x - pts[0].x).toBeCloseTo(300, 0);
    expect(next.w / next.baseW).toBe(1);
  });
});

describe('highlighter pressure', () => {
  it('a stylus highlighter stroke is thinner where it presses lightly; a mouse one stays even', () => {
    const light = capturePressure({ pressure: 0.1, real: true }, 0.5, 3, true);
    const firm = capturePressure({ pressure: 0.9, real: true }, 0.5, 3, true);
    expect(radiusAt(20, true, light)).toBeLessThan(radiusAt(20, true, firm) - 2);
    const slow = capturePressure({ pressure: 0.5, real: false }, 0.5, 1, true);
    const fast = capturePressure({ pressure: 0.5, real: false }, 0.5, 40, true);
    expect(radiusAt(20, true, slow)).toBe(radiusAt(20, true, fast));
  });
});

describe('Shift-constrained straight strokes', () => {
  it('turn a wobbly drag to the nearest 15° step from the start, keeping its length', () => {
    const from = { x: 100, y: 100 };
    const at = (deg: number, len = 200) => ({
      x: from.x + Math.cos((deg * Math.PI) / 180) * len,
      y: from.y + Math.sin((deg * Math.PI) / 180) * len,
    });
    const angle = (p: { x: number; y: number }) => (Math.atan2(p.y - from.y, p.x - from.x) * 180) / Math.PI;
    expect(angle(constrainAngle(from, at(4)))).toBeCloseTo(0);
    expect(angle(constrainAngle(from, at(41)))).toBeCloseTo(45);
    expect(angle(constrainAngle(from, at(-94)))).toBeCloseTo(-90);
    expect(angle(constrainAngle(from, at(170)))).toBeCloseTo(165);
    const end = constrainAngle(from, at(41));
    expect(Math.hypot(end.x - from.x, end.y - from.y)).toBeCloseTo(200, 0);
  });
});
