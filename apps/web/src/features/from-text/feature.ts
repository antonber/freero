import { defineFeature } from '@engine';

export default defineFeature({
  name: 'from-text',
  description:
    'Insert from text: paste an outline, a list, Mermaid, an org chart or a table and get a laid-out mind map, diagram, kanban, sticky notes or table (live preview, one undo step). Diagrams keep their source, so editing it re-lays them out.',
  // diagram id → DiagramRecord (lib/reconcile.ts): the source and what its last layout wrote.
  owns: ['diagramSources'],
  // The source belongs to the elements: undoing an insert or an update takes it back too.
  undoable: ['diagramSources'],
});
