import type { NewElement } from '@engine';

export type TemplateCategory = 'brainstorm' | 'agile' | 'strategy' | 'diagramming' | 'meetings' | 'planning';

export const CATEGORIES: Array<{ id: TemplateCategory; label: string }> = [
  { id: 'brainstorm', label: 'Brainstorm' },
  { id: 'agile', label: 'Agile' },
  { id: 'strategy', label: 'Strategy' },
  { id: 'diagramming', label: 'Diagramming' },
  { id: 'meetings', label: 'Meetings' },
  { id: 'planning', label: 'Planning' },
];

export interface TemplateDef {
  id: string;
  name: string;
  description: string;
  categories: TemplateCategory[];
  /** Extra search terms. */
  keywords: string[];
  /** Pure: builds the template at the origin with ids from `newId` (fresh on every call). */
  build(newId: () => string): NewElement[];
}
