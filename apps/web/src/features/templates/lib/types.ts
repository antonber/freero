import type { NewElement } from '@engine';

export type TemplateCategory =
  | 'brainstorm'
  | 'icebreakers'
  | 'meetings'
  | 'agile'
  | 'product'
  | 'design'
  | 'research'
  | 'strategy'
  | 'consulting'
  | 'sales'
  | 'people'
  | 'operations'
  | 'planning'
  | 'personal'
  | 'diagramming'
  | 'engineering'
  | 'ai'
  | 'education';

/** In the order the picker shows them; a template is listed under its FIRST category when browsing all. */
export const CATEGORIES: Array<{ id: TemplateCategory; label: string }> = [
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'icebreakers', label: 'Team building' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'agile', label: 'Agile' },
  { id: 'product', label: 'Product' },
  { id: 'design', label: 'Design' },
  { id: 'research', label: 'Research & UX' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'consulting', label: 'Consulting' },
  { id: 'sales', label: 'Sales & marketing' },
  { id: 'people', label: 'HR & people' },
  { id: 'operations', label: 'Operations' },
  { id: 'planning', label: 'Planning' },
  { id: 'personal', label: 'Personal' },
  { id: 'diagramming', label: 'Diagramming' },
  { id: 'engineering', label: 'Engineering' },
  { id: 'ai', label: 'AI & agents' },
  { id: 'education', label: 'Education' },
];

/** What a template builds: its elements, plus content kept outside them (table cells), by element id. */
export interface BuiltTemplate {
  elements: NewElement[];
  /** `ElementsSnapshot.content` format: what the element's `pasteContent` accepts. */
  content: Record<string, unknown>;
}

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  categories: TemplateCategory[];
  /** Extra search terms. */
  keywords: string[];
  /**
   * Fetches what `build` needs when it isn't bundled with the catalog (spec templates keep their
   * content in a chunk per file). Await it before `build`; templates without it build right away.
   */
  load?(): Promise<void>;
  /**
   * Pure: builds the template at the origin with ids from `newId` (fresh on every call). Only
   * called when the template is inserted or its preview scrolls into view.
   */
  build(newId: () => string): BuiltTemplate;
}
