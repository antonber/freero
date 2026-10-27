// The template catalog, in the order the panel shows them.
import type { TemplateDef } from '../types';
import { kanban, retrospective, storyMap } from './agile';
import { brainstorm, icebreaker, mindmap } from './ideas';
import { customerJourney, prioritization, roadmap, swot } from './strategy';
import { flowchart, meetingNotes, weeklyPlanner } from './work';

export const TEMPLATES: TemplateDef[] = [
  brainstorm,
  retrospective,
  kanban,
  weeklyPlanner,
  swot,
  prioritization,
  flowchart,
  mindmap,
  storyMap,
  customerJourney,
  meetingNotes,
  roadmap,
  icebreaker,
];
