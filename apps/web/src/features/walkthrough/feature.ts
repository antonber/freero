import { defineFeature } from '@engine';

// The `walkthroughs` collection holds one WalkthroughSummary per recording (@freero/shared
// walkthroughs.ts). Its only writer is the SERVER (modules/walkthroughs): this feature reads it for
// the live list and asks the server for everything else through Host.walkthroughs.
export default defineFeature({
  name: 'walkthrough',
  description:
    'Async walkthroughs: record your voice (and camera) while you move around the board; others play it back on the live board, which follows your view and pointer, with captions, comments at moments and view counts.',
  owns: ['walkthroughs'],
});
