import { defineFeature } from '@engine';

export default defineFeature({
  name: 'suggestions',
  description:
    'Suggestions: apps, agents and AI actions propose new items, edits and deletions instead of making them; owners and editors see them as ghosts with the proposer’s badge and accept or reject each one or a whole proposal (one undo step), and out-of-date ones never overwrite without asking.',
});
