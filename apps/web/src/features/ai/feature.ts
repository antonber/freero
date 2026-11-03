import { defineFeature } from '@engine';

export default defineFeature({
  name: 'ai',
  description:
    'AI actions with the model provider the server or workspace configured: generate ideas, cluster notes by theme or sentiment, summarise (a meeting into its own frame), write a report of a live activity’s results, and draw a diagram from text — previewed first, inserted as one undo step.',
});
