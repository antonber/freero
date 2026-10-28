// Auto-layout of a selected diagram (KAI-118).
import { describe, expect, it } from 'vitest';
import type { BoardElement, ConnectorElement } from '@freero/shared';
import { createTestBoard } from '@engine';
import manifest from './feature';
import { autoLayout, planAutoLayout } from './lib/autoLayout';
import type { Unit } from './lib/arrange';

const line = (id: string, from: string | null, to: string | null, extra: Partial<ConnectorElement> = {}): ConnectorElement =>
  ({
    id,
    type: 'connector',
    x: 0,
    y: 0,
    w: 1,
    h: 1,
    rotation: 0,
    z: 0,
    createdBy: 'x',
    createdAt: 1,
    updatedAt: 1,
    start: { elementId: from, x: 0, y: 0 },
    end: { elementId: to, x: 500, y: 500 },
    routing: 'straight',
    stroke: '#000',
    strokeWidth: 2,
    strokeStyle: 'solid',
    startCap: 'none',
    endCap: 'arrow',
    label: '',
    waypoints: [],
    ...extra,
  }) as ConnectorElement;

describe('auto-layout', () => {
  it('lays a 20-node DAG with crossing edges out top-down: no boxes overlap, every edge points down, a locked box stays put', () => {
    // Scattered on purpose: a pile where edges cross everywhere.
    const units: Unit[] = Array.from({ length: 20 }, (_, i) => ({ ids: [`n${i}`], box: { x: (i * 397) % 900, y: (i * 211) % 700, w: 120 + (i % 3) * 20, h: 60 }, locked: false }));
    units.push({ ids: ['locked'], box: { x: 5000, y: 5000, w: 100, h: 100 }, locked: true });
    const edges: Array<[number, number]> = [];
    for (let i = 0; i < 20; i++) for (const d of [1, 3, 7]) if (i + d < 20 && (i * d) % 4 !== 3) edges.push([i, i + d]);
    const connectors = [...edges.map(([a, b], k) => line(`e${k}`, `n${a}`, `n${b}`)), line('to-locked', 'n0', 'locked')];
    const moves = planAutoLayout(units, connectors, 'down');
    const at = new Map(units.map((u) => {
      const m = moves.find((mv) => mv.ids[0] === u.ids[0]);
      return [u.ids[0], { ...u.box, x: u.box.x + (m?.dx ?? 0), y: u.box.y + (m?.dy ?? 0) }];
    }));
    expect(moves.some((m) => m.ids[0] === 'locked')).toBe(false);
    const boxes = [...at.values()];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const [a, b] = [boxes[i], boxes[j]];
        expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h).toBe(false);
      }
    for (const [a, b] of edges) expect(at.get(`n${b}`)!.y, `n${a} → n${b}`).toBeGreaterThan(at.get(`n${a}`)!.y + at.get(`n${a}`)!.h);
  });

  it('is one undo step and leaves an unattached line in the selection where it was', () => {
    const board = createTestBoard({ users: ['ann'], features: [manifest] });
    try {
      const [ed] = board.editors('arrange');
      const box = (id: string, x: number, y: number) =>
        ({ id, type: 'shape', x, y, w: 120, h: 60, shape: 'rect', fill: '#fff', fillOpacity: 1, stroke: '#000', strokeWidth: 2, strokeStyle: 'solid', text: id, fontFamily: 'sans', fontSize: 16, textColor: '#000', align: 'center', vAlign: 'middle' }) as unknown as BoardElement;
      ed.createMany([box('a', 400, 400), box('b', 0, 0), box('c', 800, 0), line('ab', 'a', 'b'), line('ac', 'a', 'c'), line('loose', null, null, { start: { elementId: null, x: 10, y: 900 }, end: { elementId: null, x: 300, y: 900 } })] as never);
      const before = ed.getElements().map((e) => ({ id: e.id, x: e.x, y: e.y }));
      ed.select(['a', 'b', 'c', 'loose']);
      autoLayout(ed, 'orgchart');
      const a = ed.getElement('a')!;
      expect(ed.getElement('b')!.y).toBeGreaterThan(a.y + a.h);
      expect(ed.getElement<ConnectorElement>('loose')!.start).toMatchObject({ x: 10, y: 900 });
      ed.undo();
      expect(ed.getElements().map((e) => ({ id: e.id, x: e.x, y: e.y }))).toEqual(before);
    } finally {
      board.destroy();
    }
  });
});
