import { describe, expect, it } from 'vitest';
import type { BoardElement, ConnectorElement } from '@freero/shared';
import { parseClipboardHtml, placeAt, remapElements, serializeClipboard } from '../editor/clipboard';

const base = { rotation: 0, z: 1, createdBy: 'u', createdAt: 0, updatedAt: 0, w: 100, h: 100 };
const frame = { ...base, id: 'f1', type: 'frame', x: 0, y: 0, title: 'F', fill: '#fff', index: 0 } as BoardElement;
const a = { ...base, id: 'a', type: 'sticky', x: 10, y: 10, frameId: 'f1', groupId: 'g1', text: 'Héllo ✓', color: 'yellow' } as unknown as BoardElement;
const b = { ...base, id: 'b', type: 'sticky', x: 300, y: 10, groupId: 'g1', frameId: 'elsewhere', text: '', color: 'pink' } as unknown as BoardElement;
const conn = {
  ...base,
  id: 'c',
  type: 'connector',
  x: 0,
  y: 0,
  start: { elementId: 'a', x: 60, y: 60 },
  end: { elementId: 'outside', x: 900, y: 900 },
} as unknown as ConnectorElement;

describe('clipboard', () => {
  it('round-trips through system clipboard HTML (as browsers wrap it), including non-ASCII text', () => {
    const { html } = serializeClipboard({ app: 'freero', version: 1, boardId: 'b1', elements: [frame, a, b, conn] }, 'Héllo ✓');
    const parsed = parseClipboardHtml(`<html><body><!--StartFragment-->${html}<!--EndFragment--></body></html>`);
    expect(parsed?.elements).toEqual([frame, a, b, conn]);
  });

  it('ignores HTML that is not a Freero payload', () => {
    expect(parseClipboardHtml('<b>hello</b>')).toBeNull();
    expect(parseClipboardHtml('<span data-freero-clipboard="bm90IGpzb24=">x</span>')).toBeNull();
  });

  it('paste gets fresh ids and rewires references inside the pasted set', () => {
    let n = 0;
    const { elements, idMap } = remapElements([frame, a, b, conn], () => `new${++n}`);
    const [f2, a2, b2, c2] = elements as [BoardElement, BoardElement, BoardElement, ConnectorElement];
    expect(new Set(elements.map((e) => e.id)).size).toBe(4);
    expect(elements.some((e) => ['f1', 'a', 'b', 'c'].includes(e.id))).toBe(false);
    expect(a2.frameId).toBe(f2.id); // frame membership follows the copy
    expect(c2.start.elementId).toBe(idMap.get('a')); // connector attaches to the copy
    expect(c2.end.elementId).toBe('outside'); // reference outside the set is kept
    expect(b2.frameId).toBeNull(); // but membership of a frame that wasn't copied is dropped
    expect(a2.groupId).toBe(b2.groupId); // group stays together…
    expect(a2.groupId).not.toBe('g1'); // …as a new group
  });

  it('placing moves the pasted set, including absolute connector points, by the same offset', () => {
    const placed = placeAt([a, conn], { x: 1000, y: 1000 });
    const dx = placed[0].x - a.x;
    const dy = placed[0].y - a.y;
    const c2 = placed[1] as ConnectorElement;
    expect(c2.start.x - conn.start.x).toBe(dx);
    expect(c2.end.y - conn.end.y).toBe(dy);
  });
});
