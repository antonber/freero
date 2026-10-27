import { defineFeature } from '@engine';

export default defineFeature({
  name: 'find',
  description: 'Find on board (Ctrl/⌘+F): searches every item text, frame title, connector label and comment; steps through matches with the camera, highlights them, and replaces text for editors.',
});
