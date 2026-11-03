import { defineFeature } from '@engine';

export default defineFeature({
  name: 'kanban',
  description:
    'Kanban boards and collections: named columns that stack what is dropped into them and set the status of task cards; add, rename, reorder and delete columns, with work-in-progress limits; fields every card on the board can hold (select, multi-select, person, date, number, text, link, checkbox), edited in the Fields panel; a View panel for what cards show, density and colour, columns grouped by any single select, person or checkbox field, swimlanes and per-column card limits; tabs that show the same cards as a table (typed cells, edited in place); focus mode, a page of the kanban arranged your own way (grouping, density, filter, sort), the keyboard and screen-reader way in and the way in on phones.',
});
