import type { TimerState } from '@freero/shared';
import { defineCommands } from '@engine';
import { MINUTE, startTimer } from './lib/timer';

export default defineCommands([
  {
    // For other features driving a session (a retro's writing phase): args { minutes }. No menus:
    // people start the timer from its own control.
    id: 'timer.start',
    label: 'Start the timer',
    run(editor, args) {
      const minutes = typeof args?.minutes === 'number' && Number.isFinite(args.minutes) ? args.minutes : 5;
      editor.collection<TimerState>('timer').set('state', startTimer(minutes * MINUTE, editor.host.serverNow(), editor.user.id));
    },
  },
  {
    // The retro stops its writing timer when the facilitator moves on (as the panel's Stop button).
    id: 'timer.stop',
    label: 'Stop the timer',
    run(editor) {
      editor.collection<TimerState>('timer').delete('state');
    },
  },
]);
