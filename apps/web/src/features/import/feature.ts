import { defineFeature } from '@engine';

export default defineFeature({
  name: 'import',
  description:
    'Files from other tools: draw.io and Excalidraw diagrams become shapes, text, connectors, frames, pen strokes and images in one undo step, with a report of what could not be mapped; a dropped .freero backup goes to the restore flow.',
});
