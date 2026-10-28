import type { NewElement } from '@engine';

export type TemplateCategory =
  | 'brainstorm'
  | 'agile'
  | 'product'
  | 'strategy'
  | 'research'
  | 'diagramming'
  | 'engineering'
  | 'meetings'
  | 'planning'
  | 'education';

/** In the order the picker shows them; a template is listed under its FIRST category when browsing all. */
export const CATEGORIES: Array<{ id: TemplateCategory; label: string }> = [
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'agile', label: 'Agile' },
  { id: 'product', label: 'Product' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'research', label: 'Research & UX' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'planning', label: 'Planning' },
  { id: 'diagramming', label: 'Diagramming' },
  { id: 'engineering', label: 'Engineering' },
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
   * Pure: builds the template at the origin with ids from `newId` (fresh on every call). Only
   * called when the template is inserted or its preview scrolls into view.
   */
  build(newId: () => string): BuiltTemplate;
}
