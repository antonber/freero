import { defineFeature } from '@engine';

export default defineFeature({
  name: 'comments',
  description: 'Comment threads pinned to the board or to an item: replies, reactions, resolve, and a comments list with unread tracking.',
  owns: ['comments'],
});
