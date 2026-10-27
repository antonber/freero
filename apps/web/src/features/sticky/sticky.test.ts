import { describe, expect, it } from 'vitest';
import type { StickyElement } from '@freero/shared';
import { createTestBoard } from '@engine';
import manifest from './feature';
import stickyDef from './element';
import { gridPositions, nextFreeSlot } from './lib/layout';
import { listItems } from './lib/paste';

describe('Tab / Mod+Enter placement', () => {
  const from = { x: 0, y: 0, w: 200, h: 200 };

  it('places the next sticky right beside the current one when the slot is free', () => {
    expect(nextFreeSlot(from, 'right', [], 24)).toEqual({ x: 224, y: 0 });
  });

  it('skips slots that are already taken instead of stacking stickies on top of each other', () => {
    const taken = [
      { x: 224, y: 0, w: 200, h: 200 },
      { x: 448, y: 10, w: 200, h: 200 }, // slightly offset, still overlapping
    ];
    expect(nextFreeSlot(from, 'right', taken, 24)).toEqual({ x: 672, y: 0 });
    expect(nextFreeSlot(from, 'below', taken, 24)).toEqual({ x: 0, y: 224 });
  });
});

describe('pasting a text list as stickies', () => {
  it('lays the stickies out in a grid centered on the paste point without overlaps', () => {
    const pts = gridPositions(5, 200, 24, { x: 1000, y: 1000 });
    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs) + 200) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys) + 200) / 2;
    expect(Math.abs(cx - 1000)).toBeLessThanOrEqual(1);
    expect(Math.abs(cy - 1000)).toBeLessThanOrEqual(1);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++)
        expect(Math.abs(pts[i].x - pts[j].x) >= 200 || Math.abs(pts[i].y - pts[j].y) >= 200).toBe(true);
  });
});

describe('which pasted text becomes stickies (and which stays a text box)', () => {
  it('a bulleted or numbered list becomes one sticky per item, prefixes stripped', () => {
    expect(listItems('- Buy milk\n- Call Ada\n* Ship it')).toEqual(['Buy milk', 'Call Ada', 'Ship it']);
    expect(listItems('1. First\n2) Second\n3. Third, with a comma')).toEqual(['First', 'Second', 'Third, with a comma']);
    expect(listItems('• one\r\n\r\n• two')).toEqual(['one', 'two']);
  });

  it('several short lines are a list even without bullets', () => {
    expect(listItems('Apples\nPears\nPlums')).toEqual(['Apples', 'Pears', 'Plums']);
  });

  it('prose stays a text box: one line, long lines, or a paragraph wrapped over short lines', () => {
    expect(listItems('Just one sentence here.')).toBeNull();
    expect(listItems(`${'A long line of prose that keeps going '.repeat(3)}\nand a second line.`)).toBeNull();
    expect(listItems('We met on Monday and\ndecided that the launch\nmoves to next week.')).toBeNull();
  });

  it('a list copied from a document (HTML list items) is a list even when its lines are long', () => {
    const long = 'An item that is clearly longer than sixty characters in total length';
    expect(listItems(`${long}\n${long}`, '<ul><li>a</li><li>b</li></ul>')).toEqual([long, long]);
  });
});

describe('pasting onto selected stickies', () => {
  it('makes a sticky in the selected sticky’s color even for prose', () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [stickyDef], tools: [], formats: [], panels: [], commands: [] }] });
    try {
      const [ann] = board.editors('sticky');
      const pink = ann.create<'sticky'>({ ...stickyDef.defaults(), color: 'pink', x: 0, y: 0 } as never, { select: true });
      const handled = stickyDef.importData!(ann, { files: [], text: 'One plain sentence.', html: null }, { x: 500, y: 0 });
      expect(handled).toBe(true);
      const made = ann.getSelection().map((id) => ann.getElement<StickyElement>(id)!);
      expect(made).toHaveLength(1);
      expect(made[0].id).not.toBe(pink);
      expect(made[0].color).toBe('pink');
      expect(made[0].text).toBe('One plain sentence.');
    } finally {
      board.destroy();
    }
  });
});
