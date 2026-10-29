import { defineFeature } from '@engine';

export default defineFeature({
  name: 'sticky',
  description:
    'Sticky notes: colored paper squares with auto-fitting text, placed with N and chained with Tab; optionally labelled with who wrote each one.',
  // The board's "Show sticky authors" setting (KAI-112).
  owns: ['stickyLabels'],
});
