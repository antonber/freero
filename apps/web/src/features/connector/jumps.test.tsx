// @vitest-environment jsdom
// Line jumps (#115): where connectors cross, the one on top hops over the one beneath — drawn
// into its own path (what the canvas and every export render), in a choice everyone agrees on,
// and kept up to date while the lines move.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { ConnectorElement } from '@freero/shared';
import { createTestBoard, type Editor, type ElementDefinition, type FeatureBundle, type TestBoard } from '@engine';
import connectorDef from './element';
import manifest from './feature';
import { lineJumps } from './lib/jumps';
import { buildConnector, styleFromOptions } from './lib/model';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const bundle: FeatureBundle = { manifest, elements: [connectorDef as unknown as ElementDefinition], tools: [], formats: [], panels: [], commands: [] };
const boards: TestBoard[] = [];
const roots: Root[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  for (const b of boards.splice(0)) b.destroy();
  document.body.innerHTML = '';
});

/** A straight line between two free points, as the connector tool makes it (its cache computed). */
const line = (ed: Editor, x1: number, y1: number, x2: number, y2: number) =>
  ed.create(buildConnector(ed, { x: x1, y: y1 }, { x: x2, y: y2 }, styleFromOptions({ routing: 'straight', endCap: 'none' })));

/** The drawn path data of line `id`, as replica `user` renders it. */
function drawnPath(board: TestBoard, user: number, id: string): () => string {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(board.element(user, id)));
  return () => host.querySelector('svg path:not(.fr-cx__halo)')!.getAttribute('d')!;
}

const ARC = /A[\d.]+ [\d.]+ -?[\d.]+ 0 [01] (-?[\d.]+) (-?[\d.]+)/g;
const arcEnds = (d: string) => [...d.matchAll(ARC)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));

describe('line jumps', () => {
  it('where two lines cross only the one on top hops, at the crossing, for everyone; bringing the other to the front moves the hop to it; the hop follows the line beneath as it moves', () => {
    const board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
    boards.push(board);
    const [ann] = board.editors('connector');
    ann.updateSettings({ lineJumps: true });
    const across = line(ann, 0, 100, 400, 100);
    const down = line(ann, 200, 0, 200, 300); // created later: on top
    act(() => board.sync());
    const bobDown = drawnPath(board, 1, down);
    const bobAcross = drawnPath(board, 1, across);
    // The hop on the vertical line spans the crossing (200, 100) and lands back on the line.
    expect(arcEnds(bobDown())).toEqual([{ x: 200, y: 108 }]);
    expect(arcEnds(bobAcross())).toEqual([]);

    act(() => ann.update<ConnectorElement>(across, { z: ann.getElement(down)!.z + 1 }));
    act(() => board.sync());
    expect(arcEnds(bobDown())).toEqual([]);
    expect(arcEnds(bobAcross())).toEqual([{ x: 208, y: 100 }]);

    // The vertical line (now beneath) moves right: the hop on the horizontal one moves with it.
    act(() => ann.update<ConnectorElement>(down, { start: { x: 300, y: 0 }, end: { x: 300, y: 300 } }));
    act(() => board.sync());
    expect(arcEnds(bobAcross())).toEqual([{ x: 308, y: 100 }]);

    act(() => ann.updateSettings({ lineJumps: false }));
    act(() => board.sync());
    expect(arcEnds(bobAcross())).toEqual([]);
  });

  it('lines that share an end, meet near one, or run along each other never hop', () => {
    const r = 8;
    // Two lines fanning out of the same point (both attached to one side of an item).
    expect(lineJumps([{ x: 0, y: 0 }, { x: 300, y: 300 }], [[{ x: 0, y: 0 }, { x: 300, y: 0 }]], r)).toEqual([]);
    // A line ending just past another (a T, its end 6 units over the line).
    expect(lineJumps([{ x: 0, y: 100 }, { x: 400, y: 100 }], [[{ x: 200, y: 0 }, { x: 200, y: 106 }]], r)).toEqual([]);
    // Overlapping along a stretch, and crossing at a grazing angle.
    expect(lineJumps([{ x: 0, y: 0 }, { x: 400, y: 0 }], [[{ x: 100, y: 0 }, { x: 300, y: 0 }]], r)).toEqual([]);
    expect(lineJumps([{ x: 0, y: 0 }, { x: 400, y: 0 }], [[{ x: 0, y: -20 }, { x: 400, y: 20 }]], r)).toEqual([]);
    // A real crossing still hops, and two lines crossing close together share one hop.
    expect(lineJumps([{ x: 0, y: 0 }, { x: 400, y: 0 }], [[{ x: 200, y: -100 }, { x: 200, y: 100 }]], r)).toEqual([{ seg: 0, from: 192, to: 208, r }]);
    expect(
      lineJumps(
        [{ x: 0, y: 0 }, { x: 400, y: 0 }],
        [
          [{ x: 200, y: -100 }, { x: 200, y: 100 }],
          [{ x: 210, y: -100 }, { x: 210, y: 100 }],
        ],
        r,
      ),
    ).toEqual([{ seg: 0, from: 192, to: 218, r }]);
  });
});
