// The timer's stored run (state-machine audit FAC-1): Stop is kept as the run's end, so a write of
// the same run made at the same moment, or offline, can't bring it back.
import { afterEach, expect, it } from 'vitest';
import type { TimerState } from '@freero/shared';
import { createTestBoard, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import commands from './commands';
import { changeTimer, pauseTimer, phaseOf, readTimer } from './lib/timer';

const T0 = 1_800_000_000_000;
const bundle: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

it('a timer someone stopped does not come back paused because someone else pressed Pause at the same moment (or offline)', () => {
  board = createTestBoard({ users: ['ann', 'bob'], features: [bundle], now: () => T0 });
  const [ann, bob] = board.editors('timer');
  ann.runCommand('timer.start', { minutes: 5 });
  board.sync();

  // The facilitator stops the timer; a participant presses Pause on the countdown they still see.
  ann.runCommand('timer.stop');
  changeTimer(bob.collection<TimerState>('timer'), (s) => pauseTimer(s, T0 + 60_000));
  board.sync();

  for (const e of [ann, bob]) expect(phaseOf(readTimer(e.collection<TimerState>('timer')), T0 + 10 * 60_000)).toBe('idle');
});
