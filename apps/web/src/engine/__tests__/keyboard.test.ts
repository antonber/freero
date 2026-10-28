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

  it("finishes a frame's items before the item beside the frame (not row by row across the board)", () => {
    setup();
    const frame = core.editor.create({ type: 'frame', x: 0, y: 0, w: 400, h: 400, title: 'Retro' } as never);
    const inTop = box(20, 60);
    const inLow = box(20, 260);
    const beside = box(600, 100); // same row as the frame's first note, outside it
    expect(core.editor.getElement(inLow)?.frameId).toBe(frame);
    const walk = [frame, inTop, inLow, beside];
    for (const id of walk) {
      press('Tab');
      expect(core.editor.getSelection()).toEqual([id]);
    }
  });
});

describe('keyboard-only moving, resizing and creating', () => {
  const key = (k: string, mods: { shift?: boolean; alt?: boolean } = {}) =>
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, code: k, shiftKey: !!mods.shift, altKey: !!mods.alt, bubbles: true, cancelable: true }),
    );

  it('Alt+arrow jumps to the nearest item that way, preferring one in line over a closer one off to the side', () => {
    setup();
    const from = box(0, 0);
    const inLine = box(500, 0);
    box(200, 300); // nearer, but mostly below
    core.editor.select([from]);
    key('ArrowRight', { alt: true });
    expect(core.editor.getSelection()).toEqual([inLine]);
    expect(core.editor.getElement(from)).toMatchObject({ x: 0, y: 0 }); // a jump never moves anything
  });

  it('Alt+Shift+arrows resize from the top-left corner, and a burst of them undoes in one step', () => {
    vi.useFakeTimers();
    setup();
    const id = box(0, 0);
    core.store.undoManager.clear();
    core.editor.select([id]);
    key('ArrowRight', { alt: true, shift: true });
    vi.advanceTimersByTime(700);
    key('ArrowRight', { alt: true, shift: true });
    key('ArrowUp', { alt: true, shift: true });
    expect(core.editor.getElement(id)).toMatchObject({ x: 0, y: 0, w: 120, h: 90 });
    vi.advanceTimersByTime(1500);
    core.editor.undo();
    expect(core.editor.getElement(id)).toMatchObject({ w: 100, h: 100 });
  });

  it('Enter with a creation tool places a new item beside the selection, not on top of it', () => {
    const note = {
      id: 'note',
      label: 'Note',
      icon: () => null,
      order: 1,
      placement: 'main' as const,
      onPointerDown: (e: { editor: { create(el: unknown): string; select(ids: string[]): void }; point: { x: number; y: number } }) => {
        const id = e.editor.create({ type: 'sticky', x: e.point.x - 50, y: e.point.y - 50 });
        e.editor.select([id]);
      },
    };
    core = makeCore({ bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>], tools: [note as never] })] });
    uninstall = installKeyboard(core);
    const existing = box(0, 0);
    core.editor.select([existing]);
    core.editor.setTool('note');
    key('Enter');
    const [made] = core.editor.getSelection();
    expect(made).not.toBe(existing);
    const a = core.editor.getElement(existing)!;
    const b = core.editor.getElement(made)!;
    expect(b.x).toBeGreaterThanOrEqual(a.x + a.w); // to its right, clear of it
    expect(b.y + b.h).toBeGreaterThan(a.y);
    expect(b.y).toBeLessThan(a.y + a.h); // level with it
  });
});

describe('typing on a selected item', () => {
  it("'?' typed into a fresh empty note is text, not the shift+/ shortcut; on a note with text the shortcut still works", () => {
    let opened = 0;
    core = makeCore({
      bundles: [
        bundle('boxes', {
          elements: [boxDef as ElementDefinition<any>],
          commands: [{ id: 'help.open', label: 'Help', shortcut: 'shift+/', minRole: 'viewer', run: () => void opened++ }],
        }),
      ],
    });
    uninstall = installKeyboard(core);
    const typeQuestionMark = () =>
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true, cancelable: true }));
    const empty = box(0, 0);
    core.editor.select([empty]);
    typeQuestionMark();
    expect(opened).toBe(0);
    expect(core.editor.getEditingId()).toBe(empty);
    expect(core.ui.getState().editRequest?.initialText).toBe('?');

    core.editor.stopEditing();
    const filled = core.editor.create({ type: 'sticky', x: 300, y: 0, text: 'Plan' } as never);
    core.editor.select([filled]);
    typeQuestionMark();
    expect(opened).toBe(1);
    expect(core.editor.getEditingId()).toBeNull();
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

// German puts '[' / ']' on AltGr+8 / AltGr+9, and Windows reports AltGr as Ctrl+Alt (KAI-84).
describe('bring to front / send to back where brackets need AltGr', () => {
  const key = (init: KeyboardEventInit, target: EventTarget = document.body) => {
    const ev = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(ev);
    return ev;
  };
  const altGr = (digit: 8 | 9) => ({ key: digit === 8 ? '[' : ']', code: `Digit${digit}`, ctrlKey: true, altKey: true });
  const onTop = (id: string, other: string) => core.editor.getElement(id)!.z > core.editor.getElement(other)!.z;

  const note = (x: number, y: number) => core.editor.create({ type: 'sticky', x, y, text: 'Plan' } as never);

  it('Ctrl+AltGr+9 / +8 reorder a selected note that has text, and so do Ctrl+Shift+↑ / ↓ on any layout', () => {
    setup();
    const a = note(0, 0);
    const b = note(50, 50);
    core.editor.select([a]);
    key(altGr(9));
    expect(onTop(a, b)).toBe(true);
    key(altGr(8));
    expect(onTop(a, b)).toBe(false);
    key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, shiftKey: true });
    expect(onTop(a, b)).toBe(true);
    key({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true, shiftKey: true });
    expect(onTop(a, b)).toBe(false);
  });

  // KAI-175: Chrome and Safari on macOS take Mod+Shift+] / [ for switching tabs.
  it('Mod+Alt+↑ / ↓ step the selection one item forward / backward, past the next overlapping item only', () => {
    setup();
    const a = box(0, 0);
    const b = box(20, 20);
    const c = box(40, 40);
    const order = () => [a, b, c].sort((x, y) => core.editor.getElement(x)!.z - core.editor.getElement(y)!.z);
    core.editor.select([a]);
    key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, altKey: true });
    expect(order()).toEqual([b, a, c]);
    key({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true, altKey: true });
    expect(order()).toEqual([a, b, c]);
  });

  // KAI-98: Windows reports AltGr as Ctrl+Alt, which used to drop '@', '€', '[' … on the floor.
  it('an AltGr character typed on a selected EMPTY note starts it with that character (even "]"), while a Ctrl+Alt shortcut on a letter stays a shortcut', () => {
    let tidied = 0;
    core = makeCore({
      bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>], commands: [{ id: 'boxes.tidy', label: 'Tidy', shortcut: 'mod+alt+t', run: () => void tidied++ }] })],
    });
    uninstall = installKeyboard(core);
    const fresh = box(0, 0);
    core.editor.select([fresh]);
    key({ key: '@', code: 'KeyQ', ctrlKey: true, altKey: true }); // German AltGr+Q
    expect(core.editor.getEditingId()).toBe(fresh);
    expect(core.ui.getState().editRequest?.initialText).toBe('@');
    core.editor.stopEditing();

    const other = box(300, 0);
    core.editor.select([other]);
    key(altGr(9)); // ']' on an empty note: typing wins over Bring to front
    expect(core.ui.getState().editRequest?.initialText).toBe(']');
    core.editor.stopEditing();

    core.editor.select([box(600, 0)]);
    key({ key: 't', code: 'KeyT', ctrlKey: true, altKey: true });
    expect(tidied).toBe(1);
    expect(core.editor.getEditingId()).toBeNull();
  });

  it('typing "]" with AltGr into text being edited types it instead of bringing the item to front', () => {
    setup();
    const a = box(0, 0);
    const b = box(50, 50);
    core.editor.select([a]);
    const field = document.createElement('div');
    field.setAttribute('data-fr-text-editor', '');
    field.contentEditable = 'true';
    document.body.append(field);
    const ev = key(altGr(9), field);
    field.remove();
    expect(ev.defaultPrevented).toBe(false);
    expect(onTop(a, b)).toBe(false);
  });
});
