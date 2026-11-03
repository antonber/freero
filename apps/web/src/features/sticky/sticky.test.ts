import { describe, expect, it } from 'vitest';
import { STICKY_COLORS, STICKY_INK, stickyInk, type StickyColor, type StickyElement, type StickyPadElement } from '@freero/shared';
import { startPeel } from './lib/pad';
import { createTestBoard, type Editor, type ElementDefinition, type FeatureBundle } from '@engine';
import manifest from './feature';
import elementDefs from './element';
import commands from './commands';

const stickyDef = elementDefs[0] as ElementDefinition<'sticky'>;
import { DELETED_USER, authorLabel, authorLabelsShown } from './lib/authors';
import { gridPositions, nextFreeSlot } from './lib/layout';
import { listItems } from './lib/paste';
import { setStickyBox } from './lib/actions';
import { stickyPreset } from './lib/constants';

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

describe('mixed-selection style', () => {
  it('a fill picked for a sticky + shape selection paints the sticky the closest paper, not the default yellow', () => {
    const sticky = { ...stickyDef.defaults(), id: 's', x: 0, y: 0 } as unknown as StickyElement;
    expect(stickyDef.applySharedStyle!(sticky, { fill: '#2F80ED' })).toEqual({ color: 'royal' });
    expect(stickyDef.applySharedStyle!(sticky, { fill: '#E5484D' })).toEqual({ color: 'red' });
    expect(stickyDef.applySharedStyle!(sticky, { fill: '#B5D6FF' })).toEqual({ color: 'blue' });
  });
});

describe('sticky author labels', () => {
  const ann = { id: 'ann', name: 'Ann Lee', color: '#000', avatarUrl: null };
  const shared = { privateRunning: false, layer: 'shared' as const, people: { ann }, gone: new Set<string>() };

  it('names a purged author "Deleted user", never by id, and an agent’s note as the app acting for its person', () => {
    expect(authorLabel({ createdBy: 'u_gone' }, { ...shared, gone: new Set(['u_gone']) })).toBe(DELETED_USER);
    // Still being looked up: nothing yet rather than the raw id.
    expect(authorLabel({ createdBy: 'u_later' }, shared)).toBeNull();
    expect(authorLabel({ createdBy: 'ann', createdVia: { kind: 'app', id: 'c1', name: 'Claude' } }, shared)).toBe('Claude for Ann Lee');
  });

  it('never names anyone while private mode runs, nor on a private draft that could end up in an export', () => {
    expect(authorLabel({ createdBy: 'ann' }, { ...shared, privateRunning: true })).toBeNull();
    expect(authorLabel({ createdBy: 'ann' }, { ...shared, layer: 'private' })).toBeNull();
    expect(authorLabel({ createdBy: 'ann' }, shared)).toBe('Ann Lee');
  });

  it('is one setting for the whole board: an editor turning it on turns it on for everyone', () => {
    const bundle: FeatureBundle = { manifest, elements: [stickyDef as never], tools: [], formats: [], panels: [], commands };
    const board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
    try {
      const [a, b] = board.editors('sticky');
      a.runCommand('sticky.toggleAuthors');
      board.sync();
      expect(authorLabelsShown(b)).toBe(true);
      b.runCommand('sticky.toggleAuthors');
      board.sync();
      expect(authorLabelsShown(a)).toBe(false);
    } finally {
      board.destroy();
    }
  });
});

describe('sticky papers and their ink', () => {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };

  it('every paper, dark ones included, gets an ink that reads at WCAG AA on it', () => {
    for (const [name, paper] of Object.entries(STICKY_COLORS)) expect(ratio(paper, stickyInk(name)), name).toBeGreaterThanOrEqual(4.5);
    expect(stickyInk('navy')).not.toBe(STICKY_INK);
  });

  it('a new sticky on a dark paper still stores the dark ink, so a client that doesn’t know the paper draws readable text on its yellow fallback', () => {
    const navy = { ...stickyDef.defaults(), color: 'navy' as StickyColor };
    expect(navy.textColor).toBe(STICKY_INK);
    expect(ratio(STICKY_COLORS.yellow, navy.textColor)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('sticky pad', () => {
  const padBoard = () =>
    createTestBoard({
      users: ['ann', 'bob'],
      roles: ['owner', 'commenter'],
      participants: [1],
      features: [{ manifest, elements: elementDefs, tools: [], formats: [], panels: [], commands: [] }],
    });
  const peelAndDrag = (editor: Editor, pad: StickyPadElement) => {
    const drag = startPeel(editor, pad, { x: 100, y: 120 })!;
    drag.move({ x: 400, y: 300 });
    drag.move({ x: 600, y: 320 });
    return drag.end(true);
  };

  it('dragging from a pad peels one sticky of its colour that keeps the grab point under the pointer, and one undo takes it back while the pad stays', () => {
    const board = padBoard();
    try {
      const [ann] = board.editors('sticky');
      const padId = ann.create<'stickypad'>({ type: 'stickypad', x: 0, y: 0, w: 208, h: 208, rotation: 0, color: 'pink' } as never);
      const id = peelAndDrag(ann, ann.getElement<StickyPadElement>(padId)!);
      const peeled = ann.getElement<StickyElement>(id)!;
      expect([peeled.type, peeled.color, peeled.x, peeled.y]).toEqual(['sticky', 'pink', 500, 200]);
      ann.undo();
      expect(ann.getElement(id)).toBeUndefined();
      expect(ann.getElement(padId)).toBeDefined();
    } finally {
      board.destroy();
    }
  });

  it('a commenter taking part peels a private draft off the pad during private mode, which nobody else sees', () => {
    const board = padBoard();
    try {
      const [ann, bob] = board.editors('sticky');
      const padId = ann.create<'stickypad'>({ type: 'stickypad', x: 0, y: 0, w: 208, h: 208, rotation: 0, color: 'pink' } as never);
      board.sync();
      bob.setPrivatePlacement(() => true, { types: ['sticky'] });
      const id = peelAndDrag(bob, bob.getElement<StickyPadElement>(padId)!);
      board.sync();
      expect(bob.layerOf(id)).toBe('private');
      expect(bob.getElement<StickyElement>(id)?.x).toBe(500);
      expect(ann.getElement(id)).toBeUndefined();
    } finally {
      board.destroy();
    }
  });
});

describe('sticky shape and size', () => {
  it('making a freely resized sticky a rectangle gives it the medium rectangle around the same center', () => {
    const board = createTestBoard({ users: ['ann'], features: [{ manifest, elements: [stickyDef], tools: [], formats: [], panels: [], commands: [] }] });
    try {
      const [ann] = board.editors('sticky');
      const id = ann.create<'sticky'>({ ...stickyDef.defaults(), x: 0, y: 0, w: 230, h: 230 } as never);
      const small = ann.create<'sticky'>({ ...stickyDef.defaults(), x: 1000, y: 0, w: 140, h: 140 } as never);
      setStickyBox(ann, [ann.getElement<StickyElement>(id)!, ann.getElement<StickyElement>(small)!], { shape: 'rect' });
      const a = ann.getElement<StickyElement>(id)!;
      expect([a.w, a.h]).toEqual([300, 200]);
      expect([a.x + a.w / 2, a.y + a.h / 2]).toEqual([115, 115]);
      // A preset sticky keeps its size and changes shape only.
      expect(stickyPreset(ann.getElement<StickyElement>(small)!)).toEqual({ shape: 'rect', size: 's' });
      ann.undo();
      expect([ann.getElement<StickyElement>(id)!.w, ann.getElement<StickyElement>(small)!.w]).toEqual([230, 140]);
    } finally {
      board.destroy();
    }
  });
});
