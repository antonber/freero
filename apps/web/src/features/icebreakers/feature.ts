import { defineFeature } from '@engine';

export default defineFeature({
  name: 'icebreakers',
  description:
    'Icebreaker widgets: a wheel of names, dice and a random speaking order. The server makes every spin, roll and shuffle, so everyone sees the same result land at the same moment.',
  // Written only by the server (modules/icebreakers); claimed so no other feature writes it.
  owns: ['icebreakerResults'],
});
