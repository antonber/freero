import { defineFeature } from '@engine';

export default defineFeature({
  name: 'import',
  description:
    'Files from other tools: draw.io, Excalidraw and Visio (.vsdx) diagrams become shapes, text, connectors, frames, pen strokes and images, and PowerPoint (.pptx) decks become slides (frames) with their text, shapes, pictures, tables and speaker notes — in one undo step, with a report of what could not be mapped; a dropped .freero backup goes to the restore flow.',
});
