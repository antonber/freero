// The template catalog. Browsing all, the panel groups templates by their first category (in
// CATEGORIES order) and keeps this order inside each group; search results tie-break on it too.
// Importing this module only defines templates: each one is built when inserted or previewed.
import type { TemplateDef } from '../types';
import { kanban, retrospective, storyMap } from './agile';
import { businessModel, competitors, leanCanvas, nowNextLater, okrs } from './canvases';
import { orgChart, sitemap, swimlane, timeline, venn } from './diagrams';
import { classBrainstorm, conceptMap, exitTicket, frayerModel, kwl, lessonPlan, revisionTimetable } from './education';
import { adr, bugTriage, cicdPipeline, dataModel, incidentTimeline, postmortem, sequenceDiagram, systemArchitecture } from './engineering';
import { brainstorm, icebreaker, mindmap } from './ideas';
import { decisionLog, eightSketches, kickoff, leanCoffee, oneOnOne, workshopAgenda } from './meetings';
import { gantt, okrTracker, okrTree, onboardingPlan, sprintBoard, sprintReview } from './plans';
import { feedbackBoard, launchPlan, opportunityTree, prd, releasePlan, riceScoring } from './product';
import { affinityMap, empathyMap, interviewNotes, persona, serviceBlueprint } from './research';
import { estimation, fourLs, quarterPlanning, sprintPlanning, standup, startStopContinue } from './sprints';
import { customerJourney, prioritization, roadmap, swot } from './strategy';
import { decisionMatrix, dotVoting, howMightWe, raci, reverseBrainstorm, starbursting } from './workshops';
import { flowchart, meetingNotes, weeklyPlanner } from './work';

export const TEMPLATES: TemplateDef[] = [
  // Brainstorm
  brainstorm,
  mindmap,
  eightSketches,
  dotVoting,
  howMightWe,
  starbursting,
  reverseBrainstorm,
  // Agile
  retrospective,
  kanban,
  sprintBoard,
  sprintPlanning,
  standup,
  sprintReview,
  startStopContinue,
  fourLs,
  storyMap,
  quarterPlanning,
  estimation,
  // Product
  prd,
  opportunityTree,
  riceScoring,
  feedbackBoard,
  launchPlan,
  releasePlan,
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
  serviceBlueprint,
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
  raci,
  decisionMatrix,
  // Planning
  weeklyPlanner,
  timeline,
  okrTree,
  okrTracker,
  gantt,
  onboardingPlan,
  // Diagramming
  flowchart,
  orgChart,
  sitemap,
  swimlane,
  venn,
  // Engineering
  sequenceDiagram,
  dataModel,
  systemArchitecture,
  cicdPipeline,
  incidentTimeline,
  postmortem,
  adr,
  bugTriage,
  // Education
  lessonPlan,
  kwl,
  conceptMap,
  exitTicket,
  frayerModel,
  classBrainstorm,
  revisionTimetable,
];
