import { defineFeature } from '@engine';

export default defineFeature({
  name: 'tags',
  description: 'Board tags: name + color labels to toggle on stickies and cards, with search, create, rename, recolor and delete.',
  owns: ['tags'],
});
