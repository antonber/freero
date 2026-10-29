import { defineFeature } from '@engine';

export default defineFeature({
  name: 'meeting-notes',
  description:
    'Import meeting notes: a Markdown or text summary, or a WebVTT / SRT transcript, becomes one frame — decisions as a cluster, action items as task cards with owner and due date, other points as notes, who spoke — in one undo step, without AI.',
});
