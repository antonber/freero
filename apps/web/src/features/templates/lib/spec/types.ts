// The declarative template format. A spec says WHAT a template holds (sections, guiding
// questions, example notes, colours by meaning); an archetype (archetypes/) says how that is laid
// out with the Kit. Specs are pure data: no code, no coordinates, no hex colours.
import type { CardStatus } from '@freero/shared';
import type { TemplateCategory } from '../types';

/**
 * Freero's template tones (ui/tokens.css family, via palette.ts). Pick by meaning, the same way
 * across templates:
 * - `mint`: good, strengths, done, gains
 * - `coral`: problems, risks, pains, stop
 * - `amber`: questions, caution, assumptions, waiting
 * - `sky`: facts, data, context, information
 * - `violet`: ideas, our moves, decisions, the focus
 * - `rose`: people, feelings, relationships
 * - `gray`: neutral, backlog, parking lot
 */
export type Tone = 'violet' | 'mint' | 'coral' | 'amber' | 'sky' | 'rose' | 'gray';

/** A titled area with a guiding question and example notes written as a real team would. */
export interface Section {
  title: string;
  /** The question that tells people what belongs here. */
  prompt: string;
  /** Realistic example stickies (never placeholder text). */
  notes: string[];
  tone?: Tone;
  /** Shown before the title (icebreakers, check-ins). */
  emoji?: string;
}

/** Shared by every spec: what the picker lists and searches. */
export interface SpecMeta {
  /** Kebab-case, unique across the whole catalog (hand-coded templates included). */
  id: string;
  name: string;
  description: string;
  /** The first one is where the picker lists it. */
  categories: TemplateCategory[];
  /** Extra search terms, lower case. */
  keywords: string[];
  /** The one-line instruction under the title. */
  hint: string;
}

export interface MatrixLayout {
  archetype: 'matrix';
  /** Top-left, top-right, bottom-left, bottom-right. */
  quadrants: [Section, Section, Section, Section];
  /** Axis labels, e.g. { x: 'Effort', y: 'Impact' } (grows right / up). */
  axes?: { x: string; y: string };
  /** A column beside the grid, e.g. notes still to sort. */
  side?: Section;
}

export interface ColumnsLayout {
  archetype: 'columns';
  /** 2–6 columns of notes, left to right. */
  columns: Section[];
}

export interface KanbanLayout {
  archetype: 'kanban';
  /** The board's own title (default: the template name). */
  board?: string;
  columns: Array<{ title: string; tone?: Tone; status?: CardStatus; wip?: number; cards: Array<{ title: string; note?: string }> }>;
  /** Guidance beside the board. */
  side?: Section;
}

export interface CanvasLayout {
  archetype: 'canvas';
  /** Grid columns (2–4); sections flow left to right, `span` widens one. */
  cols: number;
  sections: Array<Section & { span?: number }>;
}

export interface TimelineLayout {
  archetype: 'timeline';
  /** 3–7 phases left to right; `when` is a date or duration under the phase name. */
  phases: Array<Section & { when?: string }>;
}

export interface FunnelLayout {
  archetype: 'funnel';
  /** 3–6 stages, widest first. */
  stages: Section[];
}

export interface JourneyLayout {
  archetype: 'journey';
  /** 3–6 stages across. */
  stages: string[];
  /** 2–6 rows; `cells` has one note per stage ('' leaves a cell empty). */
  rows: Array<{ title: string; prompt: string; tone?: Tone; cells: string[] }>;
}

export interface TreeBranch {
  text: string;
  tone?: Tone;
  children?: string[];
}

export interface TreeLayout {
  archetype: 'tree';
  root: string;
  /** 2–6 branches, each with up to 4 children. */
  branches: TreeBranch[];
  /** How to use the map, beside it. */
  side: Section;
}

export interface PromptsLayout {
  archetype: 'prompts';
  /** 3–8 questions, each answered with notes in its row. */
  items: Array<{ prompt: string; detail?: string; tone?: Tone; notes: string[] }>;
}

export type TableCellSpec = string | { t: string; tone: Tone };

export interface TableLayout {
  archetype: 'table';
  /** 2–8 columns; `w` in board pixels (default 200). */
  columns: Array<{ title: string; w?: number }>;
  /** Example rows; a row may be shorter than the columns (the rest stays empty). */
  rows: TableCellSpec[][];
  /** A key or guidance beside the table. */
  side?: Section;
}

export interface ClustersLayout {
  archetype: 'clusters';
  /** 2–9 groups of notes, flowing in `cols` columns (default up to 3). */
  clusters: Section[];
  cols?: number;
}

export interface HubLayout {
  archetype: 'hub';
  center: Section;
  /** 3–8 sections around the center: left, right, then alternately above and below it. */
  around: Section[];
}

export interface FlowLayout {
  archetype: 'flow';
  /** 3–7 steps left to right, each with notes under it. */
  steps: Array<{ title: string; kind?: 'start' | 'step' | 'end'; tone?: Tone; notes: string[] }>;
  /** What the notes under the steps are (e.g. "Who and which tool"). */
  notesLabel: string;
}

export type SpecLayout =
  | MatrixLayout
  | ColumnsLayout
  | KanbanLayout
  | CanvasLayout
  | TimelineLayout
  | FunnelLayout
  | JourneyLayout
  | TreeLayout
  | PromptsLayout
  | TableLayout
  | ClustersLayout
  | HubLayout
  | FlowLayout;

export type Archetype = SpecLayout['archetype'];

export type TemplateSpec = SpecMeta & SpecLayout;

/** What the catalog index keeps of a spec (the rest loads with its file). */
export type SpecIndexEntry = Pick<SpecMeta, 'id' | 'name' | 'description' | 'categories' | 'keywords'> & { archetype: Archetype; file: string };
