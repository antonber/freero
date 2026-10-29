import { defineFeature } from '@engine';

export default defineFeature({
  name: 'timeline',
  description:
    'Timelines (Gantt): a date axis by day, week, month or quarter with lanes; bars, milestones and task cards sit at their dates, dragging one changes its dates, and connectors between bars show dependencies.',
});
