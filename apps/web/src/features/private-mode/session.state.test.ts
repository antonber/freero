// Private mode's session (state-machine audit FAC-1): the reveal ends it for good.
import { expect, it } from 'vitest';
import { createTestBoard, type FeatureBundle } from '@engine';
import manifest from './feature';
import commands from './commands';
import { getSession, revealAndEnd, setAnonymous, start } from './lib/session';

const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands };

it('private mode revealed while the owner switches it to anonymous at the same moment stays ended, whichever write wins', () => {
  // Which of two concurrent writes of one value wins depends on the replicas' random client ids:
  // enough runs, each way round, that both outcomes are met.
  for (let run = 0; run < 12; run++) {
    const board = createTestBoard({ users: ['ann', 'bob'], features: [bundle] });
    const editors = board.editors('private-mode');
    start(editors[0], null);
    board.sync();

    const [revealer, switcher] = run % 2 ? [editors[1], editors[0]] : [editors[0], editors[1]];
    revealAndEnd(revealer);
    setAnonymous(switcher, true);
    board.sync();

    // Otherwise participants' new stickies would go private again while the retro has moved on.
    for (const e of editors) expect(getSession(e), `run ${run}`).toBeUndefined();
    board.destroy();
  }
});
