// The dot vote's session (state-machine audit FAC-1): "Clear results" removes it for good.
import { expect, it } from 'vitest';
import { createTestBoard, type FeatureBundle } from '@engine';
import manifest from './feature';
import commands from './commands';
import { clear, end, start } from './lib/actions';
import { getSession, type VotingValue } from './lib/voting';

const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands };

it('results cleared while someone ends the vote at the same moment leave no empty vote behind', () => {
  const board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
  const [ann, bob] = board.editors('voting');
  start(ann, { title: 'Lunch', votesPerUser: 2, hideResults: false, elementIds: null });
  board.sync();

  clear(ann);
  end(bob);
  board.sync();

  for (const e of [ann, bob]) expect(getSession(e.collection<VotingValue>('voting'))).toBeUndefined();
  board.destroy();
});
