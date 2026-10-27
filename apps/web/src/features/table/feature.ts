import { defineFeature } from '@engine';

export default defineFeature({
  name: 'table',
  description:
    'Tables: rows and columns of rich-text cells with a header row, fills, resizable dividers, Tab / arrow navigation, spreadsheet paste and CSV export. Cells are stored one per key so people can type in different cells at once.',
  owns: ['tableCells'],
  // Cell edits are undone like any other edit (same steps as the element changes around them).
  undoable: ['tableCells'],
});
