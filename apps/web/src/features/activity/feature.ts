import { defineFeature } from '@engine';

export default defineFeature({
  name: 'activity',
  description:
    'Board activity: a side panel listing who did what on the board ("Ann added 12 sticky notes in frame “Ideas”"), one entry per person per burst of work, as the server recorded it.',
});
