import { describe, expect, it } from 'vitest';
import type { ElementType } from '@freero/shared';
import type { NewElement } from '@engine';
import { TEMPLATES } from './lib/catalog';
import { boundsOf, instantiate, type BoardSnapshot } from './lib/place';

// Every field of each shared element type that the engine does NOT fill in on create.
const REQUIRED: Record<ElementType, string[]> = {
  sticky: ['color', 'text', 'fontFamily', 'fontSize', 'textColor', 'align', 'vAlign'],
  shape: ['shape', 'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeStyle', 'text', 'fontFamily', 'fontSize', 'textColor', 'align', 'vAlign'],
  text: ['text', 'fontFamily', 'fontSize', 'textColor', 'align', 'background', 'autoWidth'],
  connector: ['start', 'end', 'routing', 'stroke', 'strokeWidth', 'strokeStyle', 'startCap', 'endCap', 'label'],
  pen: ['points', 'stroke', 'strokeWidth', 'highlighter', 'baseW', 'baseH'],
  frame: ['title', 'fill', 'index'],
  image: ['src', 'naturalW', 'naturalH'],
  card: ['title', 'description', 'color'],
  emoji: ['emoji'],
  mindmap: ['text', 'parentId', 'rootId', 'color'],
};

let seq = 0;
const freshId = () => `id${++seq}`;
const SPOT = { x: 300, y: -200 };
const emptyBoard: BoardSnapshot = { place: () => SPOT, maxFrameIndex: -1 };

function anchorOf(el: NewElement, anchor: string) {
  if (anchor === 'top') return { x: el.x + el.w / 2, y: el.y };
  if (anchor === 'bottom') return { x: el.x + el.w / 2, y: el.y + el.h };
  if (anchor === 'left') return { x: el.x, y: el.y + el.h / 2 };
  return { x: el.x + el.w, y: el.y + el.h / 2 };
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, def) => {
  it('builds only fully specified elements, so nothing renders half-initialised when an element feature lacks defaults', () => {
    const els = def.build(freshId);
    expect(els.length).toBeGreaterThan(3);
    for (const el of els) {
      for (const key of ['x', 'y', 'w', 'h']) {
        const v = (el as unknown as Record<string, number>)[key];
        expect(Number.isFinite(v), `${el.type}.${key}`).toBe(true);
      }
      expect(el.w).toBeGreaterThan(0);
      expect(el.h).toBeGreaterThan(0);
      for (const key of REQUIRED[el.type]) {
        expect((el as unknown as Record<string, unknown>)[key], `${def.id}: ${el.type}.${key}`).not.toBeUndefined();
      }
    }
  });

  it('keeps every element of a frame inside that frame, so moving the frame carries the whole template', () => {
    const els = def.build(freshId);
    const frames = new Map(els.filter((e) => e.type === 'frame').map((f) => [f.id!, f]));
    expect(frames.size).toBeGreaterThan(0);
    for (const el of els) {
      if (el.type === 'frame' || !el.frameId) continue;
      const f = frames.get(el.frameId);
      expect(f, `${el.type} points at a frame outside the template`).toBeDefined();
      expect(el.x).toBeGreaterThanOrEqual(f!.x);
      expect(el.y).toBeGreaterThanOrEqual(f!.y);
      expect(el.x + el.w).toBeLessThanOrEqual(f!.x + f!.w);
      expect(el.y + el.h).toBeLessThanOrEqual(f!.y + f!.h);
    }
  });

  it('after insertion, connector and mind-map references point at elements of the same insert, at their anchors', () => {
    const board: BoardSnapshot = { place: () => ({ x: 1234, y: -567 }), maxFrameIndex: 2 };
    const els = instantiate(def, board, freshId);
    const byId = new Map(els.map((e) => [e.id!, e]));
    expect(byId.size, 'ids are unique').toBe(els.length);
    for (const el of els) {
      if (el.frameId) expect(byId.get(el.frameId)?.type).toBe('frame');
      if (el.type === 'connector') {
        const c = el as NewElement<'connector'>;
        for (const end of [c.start, c.end]) {
          if (!end.elementId) continue;
          const target = byId.get(end.elementId);
          expect(target, 'connector end attached to a missing element').toBeDefined();
          // Cached endpoint must move with the template, or the line flashes at the old spot.
          expect(end).toMatchObject(anchorOf(target!, end.anchor!));
        }
      }
      if (el.type === 'mindmap') {
        const m = el as NewElement<'mindmap'>;
        expect(byId.get(m.rootId)?.type).toBe('mindmap');
        if (m.parentId) expect(byId.get(m.parentId)?.type).toBe('mindmap');
      }
    }
  });
});

describe('inserting a template', () => {
  it('fills exactly the free spot the board found for its size, so it covers nothing (the engine keeps that spot clear)', () => {
    for (const def of TEMPLATES) {
      let asked: { w: number; h: number } | null = null;
      const placed = boundsOf(instantiate(def, { place: (size) => ((asked = size), SPOT), maxFrameIndex: -1 }, freshId))!;
      expect(placed, def.id).toEqual({ x: SPOT.x, y: SPOT.y, w: asked!.w, h: asked!.h });
    }
  });

  it('twice in a row never reuses an element id (which would overwrite the first copy)', () => {
    const def = TEMPLATES[0];
    const a = instantiate(def, emptyBoard, freshId).map((e) => e.id);
    const b = instantiate(def, emptyBoard, freshId).map((e) => e.id);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('numbers new frames after the existing ones so presentation order keeps the old frames first', () => {
    const board: BoardSnapshot = { ...emptyBoard, maxFrameIndex: 4 };
    const frames = TEMPLATES.flatMap((d) => instantiate(d, board, freshId)).filter((e) => e.type === 'frame') as NewElement<'frame'>[];
    for (const f of frames) expect(f.index).toBeGreaterThan(4);
  });
});
