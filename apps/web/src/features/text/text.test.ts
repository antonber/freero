import { describe, expect, it } from 'vitest';
import type { TextElement } from '@freero/shared';
import { layoutText, type LaidOutText, type MeasureFn } from './lib/layout';
import { pastedTextToRich, textBlockAt } from './lib/actions';
import { PASTE_MAX_WIDTH } from './lib/constants';

// Deterministic stand-in for the DOM: each character is fontSize/2 wide, one line per wrap.
function fakeMeasure(chars: number, fontSize: number): MeasureFn {
  const line = fontSize * 1.3;
  const natural = chars * fontSize * 0.5;
  return (wrap) => (wrap === null ? { w: natural, h: line } : { w: wrap, h: line * Math.max(1, Math.ceil(natural / wrap)) });
}

function textEl(p: Partial<LaidOutText>): LaidOutText {
  return {
    id: 't', type: 'text', x: 0, y: 0, w: 100, h: 26, rotation: 0, z: 1, createdBy: 'u', createdAt: 0, updatedAt: 0,
    text: 'hello', fontFamily: 'sans', fontSize: 20, textColor: '#000', align: 'left', background: 'transparent', autoWidth: true,
    ...p,
  } as TextElement;
}

describe('text box sizing', () => {
  it('grows an auto-width box with what you type instead of wrapping it', () => {
    // Laid out for 10 chars (w 100), now holds 30.
    const el = textEl({ w: 100, autoW: 100 });
    const patch = layoutText(el, fakeMeasure(30, 20));
    expect(patch?.w).toBe(300);
    expect(patch?.autoWidth).toBeUndefined();
  });

  it('dragging a side handle turns an auto-width box into a wrapping fixed-width box', () => {
    // Content is 300 wide; the user dragged the right edge to 120.
    const el = textEl({ w: 120, autoW: 300 });
    const patch = layoutText(el, fakeMeasure(30, 20))!;
    expect(patch.autoWidth).toBe(false);
    expect(patch.w).toBeUndefined(); // keeps the dragged width
    expect(patch.h).toBe(26 * 3); // 300 / 120 → 3 lines
    // Later edits keep wrapping at that width rather than snapping back to auto width.
    const after = layoutText({ ...el, ...patch } as LaidOutText, fakeMeasure(60, 20))!;
    expect(after.w).toBeUndefined();
    expect(after.h).toBe(26 * 5);
  });

  it('corner-scaling an auto-width box (width and font together) keeps it auto-width', () => {
    // 30 chars at 20px = 300 wide; corner drag doubled both w and font size.
    const el = textEl({ w: 600, fontSize: 40, autoW: 300 });
    const patch = layoutText(el, fakeMeasure(30, 40));
    expect(patch?.autoWidth).toBeUndefined();
    expect(patch?.autoW).toBe(600);
  });

  it('a format change on an auto-width box re-fits it instead of mistaking it for a resize', () => {
    // Bigger font from the toolbar: w still equals the last laid-out width.
    const el = textEl({ w: 300, fontSize: 30, autoW: 300 });
    const patch = layoutText(el, fakeMeasure(30, 30));
    expect(patch?.autoWidth).toBeUndefined();
    expect(patch?.w).toBe(450);
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
