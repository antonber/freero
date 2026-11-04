import type { NewElement } from '@engine';

import { t } from '../messages';
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
  { id: 'brainstorm', label: t('brainstorm') },
  { id: 'icebreakers', label: t('teamBuilding') },
  { id: 'meetings', label: t('meetings') },
  { id: 'agile', label: t('agile') },
  { id: 'product', label: t('product') },
  { id: 'design', label: t('design') },
  { id: 'research', label: t('researchUx') },
  { id: 'strategy', label: t('strategy') },
  { id: 'consulting', label: t('consulting') },
  { id: 'sales', label: t('salesMarketing') },
  { id: 'people', label: t('hrPeople') },
  { id: 'operations', label: t('operations') },
  { id: 'planning', label: t('planning') },
  { id: 'personal', label: t('personal') },
  { id: 'diagramming', label: t('diagramming') },
  { id: 'engineering', label: t('engineering') },
  { id: 'ai', label: t('aiAgents') },
  { id: 'education', label: t('education') },
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
