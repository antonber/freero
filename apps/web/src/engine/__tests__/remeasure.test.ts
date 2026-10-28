import { describe, expect, it } from 'vitest';
import type { ElementDefinition } from '../api';
import { boxDef, bundle, makeCore } from './harness';

// A text-like element whose size comes from a measurement that changes once web fonts load.
let lineHeight = 10;
const measuredDef: ElementDefinition<'sticky'> = {
  ...boxDef,
  normalize: (el) => ({ h: lineHeight * Math.max(1, String(el.text).length) }),
};

function setup() {
  lineHeight = 10;
  const core = makeCore({ bundles: [bundle('t', { elements: [measuredDef] })] });
  const ed = core.editor;
  const id = ed.create({ type: 'sticky', x: 0, y: 0, text: 'ab' } as never);
  core.store.undoManager.stopCapturing();
  ed.update(id, { text: 'abcd' } as never);
  const text = () => (ed.getElement(id) as { text?: string } | null)?.text ?? null;
  return { core, ed, id, text };
}

describe('re-measuring text when web fonts load', () => {
  // Yjs never undoes a map key over a newer untracked value: a silent re-measure made every
  // undo of that text box do nothing.
  it('leaves undo working for the re-measured item', () => {
    const { ed, id, text } = setup();
    lineHeight = 12; // fonts arrived
    ed.renormalizeMeasured();
    expect(ed.getElement(id)?.h).toBe(48);
    ed.undo();
    expect(text()).toBe('ab');
    ed.undo();
    expect(ed.getElement(id)).toBeFalsy();
  });

  it('keeps the redo steps when fonts load mid-undo, and re-measures with the next change', async () => {
    const { core, ed, id, text } = setup();
    core.store.undoManager.stopCapturing();
    const other = ed.create({ type: 'sticky', x: 300, y: 0, text: 'xyz' } as never);
    ed.undo(); // removes `other`; `id` is still this client's measurement
    lineHeight = 12;
    ed.renormalizeMeasured();
    expect(ed.getElement(id)?.h).toBe(40); // not yet: writing now would discard the redo step
    ed.redo();
    expect(ed.getElement(other)).toBeTruthy();
    ed.update(other, { x: 400 }); // the next change, to another item
    await Promise.resolve();
    expect(ed.getElement(id)?.h).toBe(48);
    expect(text()).toBe('abcd');
  });
});
