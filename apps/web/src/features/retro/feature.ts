import { defineFeature } from '@engine';

export default defineFeature({
  name: 'retro',
  description:
    'Retro mode: a facilitator runs a guided retrospective (write privately under a timer, reveal and group, vote, discuss, turn the result into action item cards), each step driven through the features that own it.',
  owns: ['retro'],
});
