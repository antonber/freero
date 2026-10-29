import { describe, expect, it } from 'vitest';
import type { BoardElement, FrameElement, StickyElement } from '@freero/shared';
import { createTestBoard, type NewElement } from '@engine';
import { membershipPatches, nextFrameIndex, nextFrameTitle, orderFrames, reorderPatches } from './lib/frames';
import frameManifest from './feature';
import frameDef from './element';
import { duplicateSlide, framesInOrder } from './lib/actions';
import { layoutItems, SLIDE_LAYOUTS } from './lib/layouts';

const frame = (id: string, index: number, extra: Partial<FrameElement> = {}): FrameElement => ({
  id,
  type: 'frame',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  rotation: 0,
  z: 0,
  createdBy: 'u',
  createdAt: 0,
  updatedAt: 0,
  title: `Frame ${id}`,
  fill: '#fff',
  index,
  ...extra,
});

const sticky = (id: string, x: number, y: number, frameId: string | null = null): StickyElement => ({
  id,
  type: 'sticky',
  x,
  y,
  w: 100,
  h: 100,
  rotation: 0,
  z: 1,
  frameId,
  createdBy: 'u',
  createdAt: 0,
  updatedAt: 0,
  color: 'yellow',
  text: '',
  fontFamily: 'sans',
  fontSize: 'auto',
  textColor: '#000',
  align: 'center',
  vAlign: 'middle',
});

function applyIndexes(frames: FrameElement[], patches: Array<{ id: string; index: number }>) {
  const byId = new Map(patches.map((p) => [p.id, p.index]));
  return orderFrames(frames.map((f) => ({ ...f, index: byId.get(f.id) ?? f.index }))).map((f) => f.id);
}

describe('Frames panel drag-reorder', () => {
  const frames = [frame('A', 0), frame('B', 1), frame('C', 2), frame('D', 3)];

  it('drops a frame dragged down exactly between the rows it was released between', () => {
    // A dropped into the gap between C and D (slot 3).
    expect(applyIndexes(frames, reorderPatches(frames, 'A', 3))).toEqual(['B', 'C', 'A', 'D']);
  });

  it('drops a frame dragged up to the top and renumbers so presentation order matches the list', () => {
    const patches = reorderPatches(frames, 'D', 0);
    expect(applyIndexes(frames, patches)).toEqual(['D', 'A', 'B', 'C']);
    const after = frames.map((f) => ({ ...f, index: patches.find((p) => p.id === f.id)?.index ?? f.index }));
    expect(after.map((f) => f.index).sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('numbering new frames', () => {
  it('appends after the highest index even when deletions left gaps (never ahead of an existing slide)', () => {
    expect(nextFrameIndex([frame('A', 0), frame('C', 5)])).toBe(6);
  });

  it('does not reuse a title still on the board after a frame in the middle was deleted', () => {
    // "Frame 2" was deleted; two frames remain, but "Frame 3" is taken.
    const left = [frame('a', 0, { title: 'Frame 1' }), frame('c', 2, { title: 'Frame 3' })];
    expect(nextFrameTitle(left)).toBe('Frame 4');
  });
});

describe('frame membership when a frame is drawn or resized', () => {
  const items = (els: BoardElement[]) => els.map((el) => ({ el, bounds: { x: el.x, y: el.y, w: el.w, h: el.h } }));
  const big = frame('big', 0, { x: 0, y: 0, w: 2000, h: 2000 });
  const area = (id: string) => (id === 'big' ? big.w * big.h : undefined);

  it('a small frame drawn inside a big one takes only the items centered inside it; the rest stay in the big frame', () => {
    const small = { id: 'small', x: 100, y: 100, w: 400, h: 400 };
    const inside = sticky('in', 150, 150, 'big');
    const edge = sticky('edge', 460, 150, 'big'); // overlaps the edge, center outside
    const far = sticky('far', 1500, 1500, 'big');
    const loose = sticky('loose', 300, 300, null);
    const patches = membershipPatches(small, items([big, inside, edge, far, loose]), area);
    expect(patches).toEqual(
      expect.arrayContaining([
        { id: 'in', frameId: 'small' },
        { id: 'loose', frameId: 'small' },
      ]),
    );
    expect(patches).toHaveLength(2);
  });

  it('a big frame drawn around a small one does not steal the small frame\'s children', () => {
    const smallFrame = frame('small', 1, { x: 100, y: 100, w: 400, h: 400 });
    const child = sticky('child', 150, 150, 'small');
    const patches = membershipPatches(
      { id: 'huge', x: -100, y: -100, w: 3000, h: 3000 },
      items([smallFrame, child]),
      (id) => (id === 'small' ? smallFrame.w * smallFrame.h : undefined),
    );
    expect(patches).toEqual([]);
  });

  it('shrinking a frame (preset / fit) releases members that end up outside it', () => {
    const member = sticky('m', 1500, 1500, 'big');
    const patches = membershipPatches({ ...big, w: 800, h: 800 }, items([member]), area);
    expect(patches).toEqual([{ id: 'm', frameId: null }]);
  });
});

describe('frame grid layout', () => {
  const setup = () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest: frameManifest, elements: [frameDef], tools: [], formats: [], panels: [], commands: [] }] });
    const [ed] = board.editors('frame');
    const fid = ed.create({ type: 'frame', x: 0, y: 0, w: 1000, h: 600, title: 'Grid', fill: '#fff', index: 0 } as NewElement);
    // Three stickies roughly in a row, then the grid is switched on (2 columns, gap 20).
    const [a, b, c] = ['a', 'b', 'c'].map((t, i) => ed.create({ type: 'sticky', x: 40 + i * 300, y: 50 + i * 7, w: 100, h: 100, text: t } as NewElement));
    ed.update<FrameElement>(fid, { layout: { kind: 'grid', cols: 2, gap: 20 } });
    return { board, ed, fid, a, b, c };
  };
  const pos = (ed: ReturnType<typeof setup>['ed'], id: string) => {
    const el = ed.getElement(id)!;
    return { x: el.x, y: el.y };
  };

  it('turning it on lays the items out in reading order and the frame hugs them', () => {
    const { board, ed, fid, a, b, c } = setup();
    expect([pos(ed, a), pos(ed, b), pos(ed, c)]).toEqual([{ x: 20, y: 20 }, { x: 140, y: 20 }, { x: 20, y: 140 }]);
    expect(ed.getElement(fid)).toMatchObject({ w: 260, h: 260 });
    board.destroy();
  });

  it('an item dropped between two others takes that slot, as one undo step', () => {
    const { board, ed, a, b, c } = setup();
    // Drag c (second row) to just right of a's center: between a and b.
    ed.beginGesture();
    ed.moveBy([{ id: c, dx: 100 - 20, dy: 20 - 140 }]);
    ed.endGesture();
    expect([pos(ed, a), pos(ed, c), pos(ed, b)]).toEqual([{ x: 20, y: 20 }, { x: 140, y: 20 }, { x: 20, y: 140 }]);
    ed.undo();
    expect(pos(ed, c)).toEqual({ x: 20, y: 140 });
    expect(pos(ed, b)).toEqual({ x: 140, y: 20 });
    board.destroy();
  });
});

describe('slides (KAI-126)', () => {
  it('every slide layout stays inside its frame on a 16:9 slide, a 4:3 slide and a phone frame, so the texts belong to it', () => {
    for (const rect of [{ x: 10, y: 20, w: 1280, h: 720 }, { x: -500, y: 0, w: 1024, h: 768 }, { x: 0, y: 0, w: 390, h: 844 }])
      for (const l of SLIDE_LAYOUTS)
        for (const item of layoutItems({ ...rect, id: 'f' }, l.id)) {
          expect(item.frameId).toBe('f');
          expect(item.x).toBeGreaterThanOrEqual(rect.x);
          expect(item.y).toBeGreaterThanOrEqual(rect.y);
          expect(item.x + item.w).toBeLessThanOrEqual(rect.x + rect.w);
          expect(item.y + item.h).toBeLessThanOrEqual(rect.y + rect.h);
        }
  });

  it('a duplicated slide comes right after its original in the deck, with a copy of what is on it', () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest: frameManifest, elements: [frameDef], tools: [], formats: [], panels: [], commands: [] }] });
    const [ed] = board.editors('frame');
    const ids = ['A', 'B', 'C'].map((t, i) => ed.create({ type: 'frame', x: i * 2000, y: 0, w: 1280, h: 720, title: t, fill: '#fff', index: i } as NewElement));
    ed.create({ type: 'sticky', x: 100, y: 100, w: 100, h: 100, text: 'on A', frameId: ids[0] } as NewElement);
    const copy = duplicateSlide(ed, ids[0])!;
    expect(framesInOrder(ed).map((f) => f.id)).toEqual([ids[0], copy, ids[1], ids[2]]);
    expect(ed.getElements().filter((el) => el.frameId === copy && el.type === 'sticky')).toHaveLength(1);
    board.destroy();
  });
});
