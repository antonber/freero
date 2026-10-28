import { defineFeature } from '@engine';

export default defineFeature({
  name: 'shape',
  description:
    'Shapes: rectangles, circles, flowchart, UML, BPMN and network symbols with fill, border and rich text, drawn with S (R / O quick keys); a searchable shape library whose sets are chosen per board.',
  owns: ['shapeLibraries'],
});
