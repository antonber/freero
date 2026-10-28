import { afterEach, describe, expect, it } from 'vitest';
import type { ElementDefinition } from '../api';
import type { EngineCore } from '../runtime/core';
import { MIXED } from '../ui/TextStyleControls';
import { applySharedStyle, sharedStyles, sharedValue } from '../editor/sharedStyle';
import { boxDef, bundle, makeCore } from './harness';

// Three types sharing some style: a note whose paper is its fill (mapped to a palette), a shape
// that stores fill as is, and a text box with no fill that can't take 'auto' sizes.
const note = {
  ...boxDef,
  sharedStyle: (el: any) => ({ fill: el.color === 'blue' ? '#B5D6FF' : '#FFF3A3', fontSize: el.fontSize }),
  applySharedStyle: (_el: any, { fill, ...rest }: any) => ({ ...rest, ...(fill ? { color: fill.startsWith('#2') ? 'blue' : 'yellow' } : {}) }),
} as unknown as ElementDefinition<any>;
const shape = {
  ...boxDef,
  type: 'shape',
  defaults: () => ({ type: 'shape', w: 100, h: 100, fill: '#ffffff', fontSize: 14 }),
  sharedStyle: (el: any) => ({ fill: el.fill, fontSize: el.fontSize }),
} as unknown as ElementDefinition<any>;
const text = {
  ...boxDef,
  type: 'text',
  defaults: () => ({ type: 'text', w: 100, h: 20, fontSize: 16 }),
  sharedStyle: (el: any) => ({ fontSize: el.fontSize }),
  applySharedStyle: (_el: any, { fontSize }: any) => (typeof fontSize === 'number' ? { fontSize } : null),
} as unknown as ElementDefinition<any>;

let core: EngineCore;
afterEach(() => core?.destroy());

describe('editing a mixed selection', () => {
  it('a change reaches every item that has the style, in its own fields, as one undo step; others and locked items stay', () => {
    core = makeCore({ bundles: [bundle('mixed', { elements: [note, shape, text] })] });
    const ed = core.editor;
    const n = ed.create({ type: 'sticky', x: 0, y: 0, fontSize: 20 } as never);
    const s = ed.create({ type: 'shape', x: 200, y: 0 } as never);
    const t = ed.create({ type: 'text', x: 400, y: 0 } as never);
    const lockedShape = ed.create({ type: 'shape', x: 600, y: 0, locked: true } as never);
    const sel = () => [n, s, t, lockedShape].map((id) => ed.getElement(id)!);
    const get = (id: string, k: string) => (ed.getElement(id) as any)[k];

    // Font size: shared by all three types; the values differ, so the control reads "mixed".
    expect(sharedValue(sharedStyles(ed, sel()), 'fontSize')).toBe(MIXED);
    applySharedStyle(ed, sel(), { fontSize: 24 });
    expect([get(n, 'fontSize'), get(s, 'fontSize'), get(t, 'fontSize'), get(lockedShape, 'fontSize')]).toEqual([24, 24, 24, 14]);
    expect(sharedValue(sharedStyles(ed, sel().slice(0, 3)), 'fontSize')).toBe(24);
    ed.undo();
    expect([get(n, 'fontSize'), get(s, 'fontSize'), get(t, 'fontSize')]).toEqual([20, 14, 16]);

    // Fill: the note maps it to its palette, the shape takes it as is, the text box has none.
    applySharedStyle(ed, sel(), { fill: '#2F80ED' });
    expect([get(n, 'color'), get(s, 'fill'), get(t, 'fill')]).toEqual(['blue', '#2F80ED', undefined]);
  });

  it('shows no control for a style only one selected item has', () => {
    core = makeCore({ bundles: [bundle('mixed', { elements: [note, shape, text] })] });
    const ed = core.editor;
    const n = ed.create({ type: 'sticky', x: 0, y: 0 } as never);
    const t = ed.create({ type: 'text', x: 400, y: 0 } as never);
    const items = sharedStyles(ed, [n, t].map((id) => ed.getElement(id)!));
    expect(sharedValue(items, 'fill')).toBeNull();
    expect(sharedValue(items, 'fontSize')).not.toBeNull();
  });
});
