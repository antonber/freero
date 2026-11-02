import { defineFeature } from '@engine';

export default defineFeature({
  name: 'csv',
  description: 'CSV of stickies and task cards: export text, tags, status, assignee, due date and kanban fields; import rows as a grid or a kanban whose columns and fields come from the file.',
});
