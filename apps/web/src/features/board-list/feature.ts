import { defineFeature } from '@engine';

export default defineFeature({
  name: 'board-list',
  description:
    'Board as list: the whole board as an accessible tree in reading order (the semantic outline), for screen readers and quick skimming; Enter shows an item on the canvas.',
});
