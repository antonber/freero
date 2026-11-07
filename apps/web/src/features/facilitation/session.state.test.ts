// Facilitator controls (state-machine audit FAC-1): ending them is for good. The server holds the
// same rule for every socket (apps/server realtime/sessionEnds.test.ts).
import { expect, it } from 'vitest';
import { createTestBoard, type FeatureBundle } from '@engine';
import manifest from './feature';
import commands from './commands';
import { change, end, getSession, start } from './lib/session';

const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands };

it('facilitator controls ended while the owner locks the board at the same moment stay ended', () => {
  const board = createTestBoard({ users: ['fay', 'own'], roles: ['editor', 'owner'], features: [bundle] });
  const [fay, own] = board.editors('facilitation');
  start(fay, { allowedTypes: ['sticky'] });
  board.sync();

  end(fay);
  change(own, { locked: true });
  board.sync();

  for (const e of [fay, own]) expect(getSession(e)).toBeUndefined();
  board.destroy();
});
