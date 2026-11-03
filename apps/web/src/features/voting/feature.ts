import { defineFeature } from '@engine';

export default defineFeature({
  name: 'voting',
  description:
    'Dot voting: a facilitator starts a session (anonymous by default, up to 99 votes each, optionally a per-item cap and a timer), everyone — commenters and guests too when the board lets them take part — spends their votes on stickies, cards and shapes, then sees ranked results; earlier votes stay in the history.',
  owns: ['voting'],
});
