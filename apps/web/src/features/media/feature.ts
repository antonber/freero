import { defineFeature } from '@engine';

export default defineFeature({
  name: 'media',
  description:
    'Video, audio and any other file on the board: drop or upload a video or audio file to play it in place (each viewer plays on their own), anything else becomes a file card that downloads on click (under the workspace’s downloads policy).',
});
