import { defineFeature } from '@engine';

export default defineFeature({
  name: 'voting',
  description: 'Dot voting: a facilitator starts a session, everyone spends a fixed number of votes on stickies, cards and shapes, then sees ranked results.',
  owns: ['voting'],
});
