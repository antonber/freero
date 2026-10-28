import { defineFeature } from '@engine';

export default defineFeature({
  name: 'arrange',
  description:
    'Align, distribute and tidy up a multi-selection (format toolbar, Align ▸ menu, Alt+A/H/D/W/V/S shortcuts), and cluster selected stickies by colour or tag into labelled groups; locked items stay put, one undo step per action.',
});
