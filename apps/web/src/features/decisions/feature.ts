import { defineFeature } from '@engine';

export default defineFeature({
  name: 'decisions',
  description:
    'Decision snapshots: freeze the board or one frame under a name ("Pricing decision, 28 Oct"), read-only, with its own link docs and tickets can cite, and see what changed since.',
});
