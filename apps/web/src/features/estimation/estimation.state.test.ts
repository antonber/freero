// The planning-poker round (state-machine audit FAC-1): ending it is for good.
import { expect, it } from 'vitest';
import { createTestBoard, type FeatureBundle } from '@engine';
import manifest from './feature';
import commands from './commands';
import { end, getRound, goTo, start } from './lib/actions';
import { DECKS } from './lib/model';

const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands };

it('a round someone ended stays ended when the owner moves to the next item at the same moment', () => {
  const board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
  const [ann, bob] = board.editors('estimation');
  const items = [ann.create({ type: 'sticky', x: 0, y: 0 } as never), ann.create({ type: 'sticky', x: 300, y: 0 } as never)];
  start(ann, items, { kind: 'fibonacci', values: DECKS.fibonacci.values });
  board.sync();

  end(bob); // "End planning poker" from the board menu
  goTo(ann, 1); // the owner's "next item", before she hears of it
  board.sync();

  for (const e of [ann, bob]) expect(getRound(e)).toBeUndefined();
  board.destroy();
});
