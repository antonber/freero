// The template catalog. Browsing all, the panel groups templates by their first category (in
// CATEGORIES order) and keeps this order inside each group; search results tie-break on it too.
// Importing this module only defines templates: each one is built when inserted or previewed.
import type { TemplateDef } from '../types';
import { kanban, retrospective, storyMap } from './agile';
import { businessModel, competitors, leanCanvas, nowNextLater, okrs } from './canvases';
import { orgChart, sitemap, swimlane, timeline, venn } from './diagrams';
import { kwl, lessonPlan } from './education';
import { brainstorm, icebreaker, mindmap } from './ideas';
import { decisionLog, eightSketches, kickoff, leanCoffee, oneOnOne, workshopAgenda } from './meetings';
import { affinityMap, empathyMap, interviewNotes, persona } from './research';
import { estimation, fourLs, quarterPlanning, sprintPlanning, standup, startStopContinue } from './sprints';
import { customerJourney, prioritization, roadmap, swot } from './strategy';
import { flowchart, meetingNotes, weeklyPlanner } from './work';

export const TEMPLATES: TemplateDef[] = [
  // Brainstorm
  brainstorm,
  mindmap,
  eightSketches,
  // Agile
  retrospective,
  kanban,
  sprintPlanning,
  standup,
  startStopContinue,
  fourLs,
  storyMap,
  quarterPlanning,
  estimation,
  // Strategy
  swot,
  prioritization,
  okrs,
  leanCanvas,
  businessModel,
  roadmap,
  nowNextLater,
  competitors,
  // Research & UX
  customerJourney,
  affinityMap,
  empathyMap,
  persona,
  interviewNotes,
  // Meetings
  meetingNotes,
  oneOnOne,
  icebreaker,
  workshopAgenda,
  kickoff,
  decisionLog,
  leanCoffee,
  // Planning
  weeklyPlanner,
  timeline,
  // Diagramming
  flowchart,
  orgChart,
  sitemap,
  swimlane,
  venn,
  // Education
  lessonPlan,
  kwl,
];
