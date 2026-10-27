import { describe, expect, it } from 'vitest';
import type { TextElement } from '@freero/shared';
import { layoutText, type MeasureFn } from './lib/layout';
import { pastedTextToRich, textBlockAt } from './lib/actions';
import { PASTE_MAX_WIDTH } from './lib/constants';
import textDef from './element';

// Deterministic stand-in for the DOM: each character is fontSize/2 wide, one line per wrap.
function fakeMeasure(chars: number, fontSize: number): MeasureFn {
  const line = fontSize * 1.3;
  const natural = chars * fontSize * 0.5;
  return (wrap) => (wrap === null ? { w: natural, h: line } : { w: wrap, h: line * Math.max(1, Math.ceil(natural / wrap)) });
}

type Box = Pick<TextElement, 'w' | 'h' | 'fontSize' | 'autoWidth'>;
const box = (p: Partial<Box>): Box => ({ w: 100, h: 26, fontSize: 20, autoWidth: true, ...p });

describe('text box sizing', () => {
  it('grows an auto-width box with what you type instead of wrapping it', () => {
    // Laid out for 10 chars (w 100), now holds 30.
    const el = box({ w: 100 });
    const patch = layoutText(el, el, fakeMeasure(30, 20));
    expect(patch?.w).toBe(300);
    expect(patch?.autoWidth).toBeUndefined();
  });

  it('dragging a side handle turns an auto-width box into a wrapping fixed-width box', () => {
    // Content is 300 wide; the user dragged the right edge to 120 (width alone changed).
    const prev = box({ w: 300 });
    const el = { ...prev, w: 120 };
    const patch = layoutText(el, prev, fakeMeasure(30, 20))!;
    expect(patch.autoWidth).toBe(false);
    expect(patch.w).toBeUndefined(); // keeps the dragged width
    expect(patch.h).toBe(26 * 3); // 300 / 120 → 3 lines
    // Later edits keep wrapping at that width rather than snapping back to auto width.
    const fixed = { ...el, ...patch } as Box;
    const after = layoutText(fixed, fixed, fakeMeasure(60, 20))!;
    expect(after.w).toBeUndefined();
    expect(after.h).toBe(26 * 5);
  });

  it('corner-scaling an auto-width box (width, height and font together) keeps it auto-width', () => {
    const prev = box({ w: 300, h: 26 });
    const el = { ...prev, w: 600, h: 52, fontSize: 40 };
    const patch = layoutText(el, prev, fakeMeasure(30, 40));
    expect(patch?.autoWidth).toBeUndefined();
  });

  it('a format change on an auto-width box re-fits it instead of mistaking it for a resize', () => {
    // Bigger font from the toolbar: w is still the old laid-out width.
    const prev = box({ w: 300 });
    const el = { ...prev, fontSize: 30 };
    const patch = layoutText(el, prev, fakeMeasure(30, 30));
    expect(patch?.autoWidth).toBeUndefined();
    expect(patch?.w).toBe(450);
  });

  it('double-clicking a side handle of a wrapping box makes it hug its text again', () => {
    const fixed = { ...box({ w: 120, h: 78 }), autoWidth: false };
    const fit = textDef.fitToContent!(fixed as TextElement, 'e');
    expect(fit).toEqual({ autoWidth: true });
    const patch = layoutText({ ...fixed, ...fit } as Box, fixed, fakeMeasure(30, 20));
    expect(patch).toMatchObject({ w: 300, h: 26 });
  });
});

describe('pasting plain text', () => {
  it('keeps every line break of a multi-line paste, including Windows line endings', () => {
    expect(pastedTextToRich('First line\r\nSecond <line>\rThird\n\n')).toBe('First line<br>Second &lt;line&gt;<br>Third');
  });

  it('ignores whitespace-only clipboard text so other importers can claim the paste', () => {
    expect(pastedTextToRich(' \n\t ')).toBeNull();
  });

  it('wraps a long paragraph in a fixed-width box instead of one endless line', () => {
    const el = textBlockAt({ x: 0, y: 0 }, 'word '.repeat(200));
    expect(el.autoWidth).toBe(false);
    expect(el.w).toBe(PASTE_MAX_WIDTH);
  });
});
