import { describe, expect, it } from 'vitest';
import type { BoardElement } from '@freero/shared';
import { copyStyle, stylePatch } from './lib/style';

const base = { id: 'x', x: 0, y: 0, w: 100, h: 100, rotation: 0, z: 0, createdBy: 'u', createdAt: 0, updatedAt: 0 };
const shape = {
  ...base,
  type: 'shape',
  shape: 'ellipse',
  fill: '#b5d7ff',
  fillOpacity: 1,
  stroke: '#123456',
  strokeWidth: 4,
  strokeStyle: 'dashed',
  text: 'Hello',
  fontFamily: 'mono',
  fontSize: 'auto',
  textColor: '#ff0000',
  align: 'left',
  vAlign: 'top',
} as unknown as BoardElement;
const sticky = { ...base, id: 's', type: 'sticky', color: 'yellow', text: 'keep me', fontFamily: 'sans', fontSize: 'auto', textColor: '#000000', align: 'center', vAlign: 'middle' } as unknown as BoardElement;
const text = { ...base, id: 't', type: 'text', text: 'keep', fontFamily: 'sans', fontSize: 24, textColor: '#000000', align: 'center', background: 'transparent', autoWidth: true } as unknown as BoardElement;

describe('format painter', () => {
  it('paints a shape’s look onto another shape but never its content, kind or size', () => {
    const target = { ...shape, id: 'y', shape: 'rect', fill: '#ffffff', stroke: '#000000', strokeStyle: 'solid', fontFamily: 'sans', textColor: '#111111', text: 'Other', w: 300 } as unknown as BoardElement;
    const patch = stylePatch(copyStyle(shape), target, {});
    expect(patch).toMatchObject({ fill: '#b5d7ff', stroke: '#123456', strokeStyle: 'dashed', fontFamily: 'mono', textColor: '#ff0000' });
    expect(patch).not.toHaveProperty('text');
    expect(patch).not.toHaveProperty('shape');
    expect(patch).not.toHaveProperty('w');
  });

  it('carries over to another type only what fits it: a blue fill becomes the closest sticky blue', () => {
    const toSticky = stylePatch(copyStyle(shape), sticky, { color: 'yellow', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle', text: '' });
    expect(toSticky).toEqual({ color: 'blue', fontFamily: 'mono', textColor: '#ff0000', align: 'left', vAlign: 'top' });
    // A sticky's 'auto' font size can't land on a text box (which needs a number).
    const toText = stylePatch(copyStyle(sticky), text, { fontFamily: 'sans', fontSize: 16, textColor: '#000', align: 'left', background: 'transparent', text: '', autoWidth: true });
    expect(toText).not.toHaveProperty('fontSize');
    expect(toText).not.toHaveProperty('color');
  });
});
