import { defineFeature } from '@engine';

export default defineFeature({
  name: 'estimation',
  description:
    'Planning poker: estimate cards and stickies one by one with a Fibonacci, T-shirt or custom deck; picks stay sealed on the server until the facilitator reveals them, then show with their spread, and the agreed value is written onto the card.',
  owns: ['estimation'],
});
