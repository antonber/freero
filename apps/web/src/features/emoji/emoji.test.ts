import { describe, expect, it } from 'vitest';
import type { EmojiElement } from '@freero/shared';
import { createTestBoard, type Rect } from '@engine';
import emojiElement from './element';
import emojiCommands from './commands';
import { reactionSlot } from './lib/reactions';
import { PACKS } from './lib/packs';
import { customSrc } from './lib/custom';

describe('sticker packs', () => {
  it('no two stickers in any pack share an id (a board would show one where the other was placed)', () => {
    const ids = PACKS.flatMap((p) => p.stickers.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('team stickers', () => {
  it('only our own uploads render: a sticker naming any other address shows nothing instead of loading it', () => {
    expect(customSrc('img:/uploads/abcDEF12_-.svg')).toBe('/uploads/abcDEF12_-.svg');
    for (const value of ['img:https://tracker.example/pixel.png', 'img://evil.example/a.png', 'img:/uploads/../api/me.png', 'img:/uploads/abcdef12.html', 'img:javascript:alert(1)'])
      expect(customSrc(value), value).toBeNull();
  });
});

describe('react with stamp', () => {
  it('reacting several times to the same item lines the stamps up instead of stacking them', () => {
    const sticky = { x: 0, y: 0, w: 200, h: 200 };
    const taken: Rect[] = [];
    const a = reactionSlot(sticky, 48, taken);
    const b = reactionSlot(sticky, 48, taken);
    const c = reactionSlot(sticky, 48, taken);
    // First one sits on the top-right corner.
    expect(a.x).toBeLessThan(200);
    expect(a.x + 48).toBeGreaterThan(200);
    expect(a.y).toBeLessThan(0);
    for (const [p, q] of [[a, b], [b, c], [a, c]]) expect(Math.abs(p.x - q.x)).toBeGreaterThanOrEqual(48 * 0.75);
  });
});

describe('reaction stamps ride on their item', () => {
  const setup = () => {
    const board = createTestBoard({
      users: ['ann'],
      features: [{ manifest: { name: 'emoji', description: '' }, elements: [emojiElement], tools: [], formats: [], panels: [], commands: emojiCommands }],
    });
    const [ed] = board.editors('emoji');
    const [sticky] = ed.createMany([{ type: 'sticky', x: 0, y: 0, w: 200, h: 200 }] as never);
    ed.select([sticky]);
    ed.runCommand('emoji.react.check');
    const stamps = () => ed.getElements().filter((el): el is EmojiElement => el.type === 'emoji');
    return { ed, sticky, stamps };
  };

  it('moves, duplicates and is deleted together with the item it reacts to', () => {
    const { ed, sticky, stamps } = setup();
    const [stamp] = stamps();
    ed.moveBy([{ id: sticky, dx: 300, dy: 40 }]);
    expect(ed.getElement(stamp.id)).toMatchObject({ x: stamp.x + 300, y: stamp.y + 40 });

    const [copy] = ed.duplicate([sticky], { x: 0, y: 400 });
    const copyStamp = stamps().find((s) => s.attachedTo === copy);
    expect(copyStamp).toMatchObject({ x: stamp.x + 300, y: stamp.y + 440 });

    ed.remove([copy]);
    expect(stamps().map((s) => s.id)).toEqual([stamp.id]);
  });

  it('dragged off onto empty canvas, a stamp stays behind when its old item moves', () => {
    const { ed, sticky, stamps } = setup();
    const [stamp] = stamps();
    ed.moveBy([{ id: stamp.id, dx: 600, dy: 0 }]);
    ed.moveBy([{ id: sticky, dx: 0, dy: 300 }]);
    expect(ed.getElement(stamp.id)).toMatchObject({ x: stamp.x + 600, y: stamp.y });
  });
});
