import type { TimerState } from '@freero/shared';
import { deadlineClock, defineCommands } from '@engine';
import { MINUTE, TIMER_KEY, startTimer, stopTimer } from './lib/timer';

import { t } from './messages';
export default defineCommands([
  {
    // For other features driving a session (a retro's writing phase): args { minutes }. No menus:
    // people start the timer from its own control.
    id: 'timer.start',
    label: t('startTheTimer'),
    run(editor, args) {
      const minutes = typeof args?.minutes === 'number' && Number.isFinite(args.minutes) ? args.minutes : 5;
      const now = deadlineClock(editor.host);
      if (now === null) return editor.host.notify(t('clockNotSyncedYet'), 'info');
      editor.collection<TimerState>('timer').set(TIMER_KEY, startTimer(minutes * MINUTE, now, editor.user.id));
    },
  },
  {
    // The retro stops its writing timer when the facilitator moves on (as the panel's Stop button).
    id: 'timer.stop',
    label: t('stopTheTimer'),
    run(editor) {
      stopTimer(editor.collection<TimerState>('timer'));
    },
  },
]);
