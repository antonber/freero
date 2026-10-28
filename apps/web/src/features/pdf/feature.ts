import { defineFeature } from '@engine';

export default defineFeature({
  name: 'pdf',
  description:
    'PDF documents on the board: upload or drop a PDF to get a document item that pages through it (pdf.js, lazy-loaded; pages rendered at the current zoom and cached), and place all its pages as images in a grid.',
});
