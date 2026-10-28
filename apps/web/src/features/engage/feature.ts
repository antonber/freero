import { defineFeature } from '@engine';

export default defineFeature({
  name: 'engage',
  description: 'Live audience activities: polls, word clouds, rankings, rating scales and Q&A, answered from the board or a phone, with results drawn on the board.',
  // Written only by the server (results of answers it keeps); claimed so no other feature writes it.
  owns: ['engageResults'],
});
