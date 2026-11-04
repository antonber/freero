import { defineFeature } from '@engine';

export default defineFeature({
  name: 'import',
  description:
    'Files from other tools: draw.io, Excalidraw and Visio (.vsdx) diagrams become shapes, text, connectors, frames, pen strokes and images, and PowerPoint (.pptx) decks become slides (frames) with their text, shapes, pictures, tables and speaker notes; boards from other whiteboards — a Miro board read with the person’s own Miro token, Mural’s and Lucid’s CSV exports — become stickies, shapes, text, cards, frames, connectors, pictures and tags — in one undo step, with a report of what could not be mapped; a dropped .freero backup goes to the restore flow.',
});
