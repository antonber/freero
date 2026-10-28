// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineCore } from '../runtime/core';
import { installKeyboard } from '../interaction/keyboard';
import { boxDef, bundle, makeCore } from './harness';
import type { ElementDefinition } from '../api';

let core: EngineCore;
let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  core?.destroy();
  vi.useRealTimers();
});

const setup = () => {
  core = makeCore();
  uninstall = installKeyboard(core);
};
const box = (x: number, y: number) => core.editor.create({ type: 'sticky', x, y } as never);
const press = (key: string, opts: { shift?: boolean } = {}) =>
  document.body.dispatchEvent(
    new KeyboardEvent('keydown', { key, code: key === 'Tab' || key.startsWith('Arrow') ? key : `Key${key.toUpperCase()}`, shiftKey: !!opts.shift, bubbles: true, cancelable: true }),
  );

describe('arrow-key nudges', () => {
  it('a burst of nudges undoes in one step, and a nudge after a pause is a step of its own', () => {
    vi.useFakeTimers();
    setup();
    const id = box(0, 0);
    core.store.undoManager.clear();
    core.editor.select([id]);
    for (let i = 0; i < 5; i++) {
      press('ArrowRight');
      vi.advanceTimersByTime(700); // slower than Yjs' own 600 ms merge window, inside the burst's 1 s
    }
    vi.advanceTimersByTime(1500);
    press('ArrowDown');
    expect(core.editor.getElement(id)).toMatchObject({ x: 5, y: 1 });
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ x: 5, y: 0 });
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ x: 0, y: 0 });
  });

  it('with snap to grid on, an arrow moves to the next grid line (Shift: five), never off the grid', () => {
    setup();
    core.editor.updateSettings({ snapToGrid: true, gridSize: 20 });
    const id = box(5, 47);
    core.editor.select([id]);
    press('ArrowRight');
    expect(core.editor.getElement(id)).toMatchObject({ x: 20, y: 47 });
    press('ArrowRight');
    press('ArrowUp');
    expect(core.editor.getElement(id)).toMatchObject({ x: 40, y: 40 });
    press('ArrowLeft', { shift: true });
    press('ArrowDown', { shift: true });
    expect(core.editor.getElement(id)).toMatchObject({ x: -60, y: 140 });
  });

  it('a pointer press ends the burst, so the next drag is not swallowed into the nudges', () => {
    vi.useFakeTimers();
    setup();
    const id = box(0, 0);
    core.store.undoManager.clear();
    core.editor.select([id]);
    press('ArrowRight');
    window.dispatchEvent(new Event('pointerdown'));
    core.editor.beginGesture();
    core.editor.update(id, { y: 50 });
    core.editor.endGesture();
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ x: 1, y: 0 });
  });
});

describe('Tab cycling', () => {
  it('Tab walks the board in reading order and wraps; Shift+Tab walks back', () => {
    setup();
    const c = box(0, 400);
    const b = box(300, 10); // same row as a (starts above a's middle), to its right
    const a = box(0, 0);
    press('Tab');
    expect(core.editor.getSelection()).toEqual([a]);
    press('Tab');
    expect(core.editor.getSelection()).toEqual([b]);
    press('Tab');
    expect(core.editor.getSelection()).toEqual([c]);
    press('Tab');
    expect(core.editor.getSelection()).toEqual([a]);
    press('Tab', { shift: true });
    expect(core.editor.getSelection()).toEqual([c]);
  });

  it('walks past items whose type claims Tab, which keep Tab once the user picks them', () => {
    let claimed = 0;
    const claiming = { ...boxDef, onKeyDown: (e: KeyboardEvent) => (e.key === 'Tab' ? (claimed++, true) : false) };
    core = makeCore({ bundles: [bundle('boxes', { elements: [claiming as ElementDefinition<any>] })] });
    uninstall = installKeyboard(core);
    const a = box(0, 0);
    const b = box(300, 0);
    press('Tab');
    press('Tab');
    expect(core.editor.getSelection()).toEqual([b]);
    expect(claimed).toBe(0);
    core.editor.select([a]); // picked by the user (click)
    press('Tab');
    expect(claimed).toBe(1);
    expect(core.editor.getSelection()).toEqual([a]);
  });
});

describe('Escape', () => {
  it('walks out of a group member to the whole group, then to nothing', () => {
    setup();
    const a = box(0, 0);
    const b = box(200, 0);
    core.editor.group([a, b]);
    core.editor.select([a]); // dived into the group (double-click)
    press('Escape');
    expect(new Set(core.editor.getSelection())).toEqual(new Set([a, b]));
    press('Escape');
    expect(core.editor.getSelection()).toEqual([]);
  });
});
