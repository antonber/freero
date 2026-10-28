import { afterEach, describe, expect, it } from 'vitest';
import type { EngineCore } from '../runtime/core';
import type { ElementDefinition } from '../api';
import { boxDef, bundle, frameDef, makeCore } from './harness';
import { replaceInRichText } from '../text/sanitize';

let core: EngineCore;
afterEach(() => core?.destroy());

const create = (el: Record<string, unknown>) => core.editor.create(el as never);

describe('Editor.moveBy (programmatic arranging)', () => {
  it('carries a frame’s children, leaves locked items put, and re-homes a moved item by the drop rule', () => {
    core = makeCore();
    const frame = create({ type: 'frame', x: 0, y: 0, w: 400, h: 300 });
    const child = create({ type: 'sticky', x: 20, y: 20 });
    const target = create({ type: 'frame', x: 1000, y: 0, w: 400, h: 300 });
    const loose = create({ type: 'sticky', x: 600, y: 0 });
    const locked = create({ type: 'sticky', x: 600, y: 400, locked: true });
    expect(core.editor.getElement(child)!.frameId).toBe(frame);
    core.editor.moveBy([
      { id: frame, dx: 0, dy: 500 },
      { id: loose, dx: 500, dy: 50 }, // its center lands inside `target`
      { id: locked, dx: 100, dy: 100 },
    ]);
    expect(core.editor.getElement(child)).toMatchObject({ x: 20, y: 520, frameId: frame });
    expect(core.editor.getElement(loose)).toMatchObject({ x: 1100, y: 50, frameId: target });
    expect(core.editor.getElement(locked)).toMatchObject({ x: 600, y: 400 });
  });
});

describe('hidden for me (Editor.setViewHidden)', () => {
  it('hiding a frame hides its contents from this viewer’s clicks and selection, not from the board', () => {
    core = makeCore();
    const frame = create({ type: 'frame', x: 0, y: 0, w: 400, h: 300 });
    const child = create({ type: 'sticky', x: 20, y: 20 });
    core.editor.select([child]);
    core.editor.setViewHidden([frame], true);
    expect(core.editor.getSelection()).toEqual([]);
    expect(core.editor.hitTest({ x: 50, y: 50 })).toBeNull();
    core.editor.select([child]);
    expect(core.editor.getSelection()).toEqual([]);
    // Still on the board (exports, collaborators): only this viewer's filter changed.
    expect(core.editor.getElements().map((el) => el.id)).toContain(child);
    core.editor.setViewHidden([frame], false);
    expect(core.editor.hitTest({ x: 50, y: 50 })?.id).toBe(child);
  });

  it('a line attached to an item hidden for me (or to something in a hidden frame) hides with it instead of pointing at nothing', () => {
    const lineDef: ElementDefinition<'connector'> = {
      type: 'connector',
      Component: () => null,
      resize: 'none',
      defaults: () => ({ type: 'connector', w: 1, h: 1, start: { x: 0, y: 0 }, end: { x: 0, y: 0 } }) as never,
      hiddenWith: (c) => [c.start.elementId, c.end.elementId],
    };
    core = makeCore({ bundles: [bundle('boxes', { elements: [boxDef as ElementDefinition<any>, frameDef as ElementDefinition<any>, lineDef as ElementDefinition<any>] })] });
    const frame = create({ type: 'frame', x: 0, y: 0, w: 400, h: 300 });
    const inFrame = create({ type: 'sticky', x: 20, y: 20 });
    const a = create({ type: 'sticky', x: 600, y: 0 });
    const b = create({ type: 'sticky', x: 900, y: 0 });
    const ab = create({ type: 'connector', x: 700, y: 50, w: 200, h: 1, start: { elementId: a }, end: { elementId: b } });
    const toFrame = create({ type: 'connector', x: 120, y: 50, w: 480, h: 1, start: { elementId: inFrame }, end: { elementId: a } });
    core.editor.select([ab]);
    core.editor.setViewHidden([b], true);
    expect([core.editor.isViewHidden(ab), core.editor.isViewHidden(toFrame)]).toEqual([true, false]);
    expect(core.editor.getSelection()).toEqual([]);
    expect(core.editor.getBounds([ab])).toBeNull();
    core.editor.setViewHidden([b], false);
    core.editor.setViewHidden([frame], true);
    expect([core.editor.isViewHidden(ab), core.editor.isViewHidden(toFrame)]).toEqual([false, true]);
  });
});

describe('replaceInRichText', () => {
  it('replaces inside formatting without touching tags, attributes or other text, and escapes the replacement', () => {
    const html = '<b>Todo</b>: fix the <a href="/todo">todo link</a> &amp; TODO list';
    const r = replaceInRichText(html, 'todo', '<done>');
    expect(r.count).toBe(3);
    expect(r.html).toBe('<b>&lt;done&gt;</b>: fix the <a href="/todo">&lt;done&gt; link</a> &amp; &lt;done&gt; list');
    expect(replaceInRichText(html, 'todo', 'x', { caseSensitive: true }).count).toBe(1);
  });

  it('replaces a word split by formatting (in the formatting it starts in) but never joins two lines', () => {
    expect(replaceInRichText('<b>Hel</b>lo world, he<i>llo</i>!', 'hello', 'Hi')).toEqual({ html: '<b>Hi</b> world, Hi!', count: 2 });
    expect(replaceInRichText('Hel<br>lo', 'hello', 'Hi').count).toBe(0);
    expect(replaceInRichText('<p>Hel</p><p>lo</p>', 'hello', 'Hi').count).toBe(0);
  });
});
