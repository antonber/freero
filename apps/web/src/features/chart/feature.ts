import { defineFeature } from '@engine';

export default defineFeature({
  name: 'chart',
  description:
    'Charts: bar, stacked bar, line, area and pie charts drawn from a small data grid people type into or paste spreadsheet rows / CSV into. Cells are stored one per key so people can edit different cells at once.',
  owns: ['chartCells'],
  // Data edits are undone like any other edit (same steps as the element changes around them).
  undoable: ['chartCells'],
});
