import { describe, expect, it } from 'vitest';
import { routePress, type PressInput } from '../interaction/touch';

const press = (p: Partial<PressInput>) => routePress({ pointerType: 'touch', pensDown: 0, penSeen: false, toolId: 'select', onItem: false, phoneView: false, ...p });

describe('fingers and pens on the canvas', () => {
  it('a palm resting on the screen while a pen draws never pans, selects or draws', () => {
    for (const toolId of ['select', 'pen', 'sticky'])
      for (const onItem of [true, false]) expect(press({ pensDown: 1, penSeen: true, toolId, onItem })).toBe('ignore');
  });

  it('once a pen was used, a finger pans instead of drawing (pen draws, finger pans); before that a finger draws', () => {
    expect(press({ penSeen: true, toolId: 'pen' })).toBe('pan');
    expect(press({ penSeen: true, toolId: 'select', onItem: true })).toBe('pan');
    expect(press({ penSeen: false, toolId: 'pen' })).toBe('tool');
  });

  it('with the lasso a finger loops round items on empty canvas; once a pen was used the pen loops and fingers pan', () => {
    expect(press({ toolId: 'lasso', onItem: false })).toBe('tool');
    expect(press({ toolId: 'lasso', penSeen: true })).toBe('pan');
    expect(press({ pointerType: 'pen', toolId: 'lasso', penSeen: true })).toBe('tool');
  });

  it('with the select tool a finger pans empty canvas but still drags items, and the mouse is never affected', () => {
    expect(press({ toolId: 'select', onItem: false })).toBe('pan');
    expect(press({ toolId: 'select', onItem: true })).toBe('tool');
    expect(routePress({ pointerType: 'mouse', pensDown: 1, penSeen: true, toolId: 'select', onItem: false, phoneView: true })).toBe('tool');
  });
});
