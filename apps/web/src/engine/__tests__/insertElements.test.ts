import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { elementAABB, elementIntersectsRect } from '../geometry/geometry';
import { makeCore } from './harness';

describe('saving content and inserting it elsewhere (templates)', () => {
  it('a saved frame lands clear of existing content with its sticky still inside the NEW frame, as one undo step', () => {
    const source = makeCore();
    const frameId = source.editor.create({ ...source.registry.elements.get('frame')!.def.defaults!(), x: 0, y: 0 } as never);
    source.editor.create({ ...source.registry.elements.get('sticky')!.def.defaults!(), x: 50, y: 50 } as never);
    // Through JSON, as the server stores it.
    const snapshot = JSON.parse(JSON.stringify(source.editor.exportElements()));

    const target = makeCore();
    const center = target.editor.getViewportCenter();
    const existing = target.editor.create({ ...target.registry.elements.get('sticky')!.def.defaults!(), x: center.x - 50, y: center.y - 50 } as never);
    const top = target.editor.insertElements(snapshot);

    const all = target.editor.getElements();
    const inserted = all.filter((el) => el.id !== existing);
    expect(inserted).toHaveLength(2);
    const frame = inserted.find((el) => el.type === 'frame')!;
    const sticky = inserted.find((el) => el.type === 'sticky')!;
    expect(top).toEqual([frame.id]);
    expect(frame.id).not.toBe(frameId);
    expect(sticky.frameId).toBe(frame.id);
    const existingBox = elementAABB(target.editor.getElement<BoardElement>(existing)!);
    for (const el of inserted) expect(elementIntersectsRect(el, existingBox)).toBe(false);

    target.editor.undo();
    expect(target.editor.getElements().map((el) => el.id)).toEqual([existing]);
  });
});
