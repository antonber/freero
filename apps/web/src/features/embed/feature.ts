import { defineFeature } from '@engine';

export default defineFeature({
  name: 'embed',
  description:
    'Pasted links become preview cards (title, description, picture fetched by the server); links to allow-listed providers (YouTube, Vimeo, Loom, Figma, Google Docs / Sheets / Slides / Forms, CodePen, CodeSandbox, and origins the operator adds) open as sandboxed live frames after a click.',
});
