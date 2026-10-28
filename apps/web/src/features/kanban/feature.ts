import { defineFeature } from '@engine';

export default defineFeature({
  name: 'kanban',
  description:
    'Kanban boards: named columns that stack what is dropped into them and set the status of task cards; add, rename, reorder and delete columns, with work-in-progress limits.',
});
