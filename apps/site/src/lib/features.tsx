// The feature pages (/features/<slug>): one thing a person comes to an online whiteboard for (a
// kanban board, a mind map, a flowchart), written by hand in its own page file. Listed here once, so
// /features shows them all and each page links to the others without a hand-kept list per page.
// Templates are catalog ids; an id the catalog no longer has fails the build (templateById throws).
import { TemplateCards, templateById, type SiteTemplate } from './templates';

export interface Feature {
  slug: string;
  /** Breadcrumb and card title. */
  name: string;
  /** One line for the /features card and the other feature pages. */
  summary: string;
  /** Catalog template ids to start from, most useful first. */
  templates: string[];
}

export const FEATURES: Feature[] = [
  {
    slug: 'online-whiteboard',
    name: 'Online whiteboard',
    summary: 'A free, real-time whiteboard for teams: unlimited editors, 5,000 boards per account, every feature included.',
    templates: ['brainstorm', 'retrospective', 'kanban', 'mindmap', 'flowchart', 'workshop-agenda'],
  },
  {
    slug: 'kanban-board',
    name: 'Kanban board',
    summary: 'Columns that set a card’s status, WIP limits, due dates and assignees, synced with Jira, Linear or GitHub.',
    templates: ['sprint-board', 'kanban', 'personal-task-board', 'backlog-refinement', 'feature-request-triage'],
  },
  {
    slug: 'mind-map',
    name: 'Mind map',
    summary: 'Keyboard-first mind maps that lay themselves out: Tab for a child, Enter for a sibling, paste an outline to start.',
    templates: ['mindmap', 'brainstorm', 'class-brainstorm', 'opportunity-solution-tree', 'causes-and-consequences'],
  },
  {
    slug: 'flowchart-maker',
    name: 'Flowcharts and diagrams',
    summary: 'Flowchart, UML, BPMN, ERD and network shapes with attached connectors, auto-layout and Mermaid import.',
    templates: ['flowchart', 'process-map', 'user-flow', 'org-chart', 'sequence-diagram', 'data-model-erd', 'system-architecture'],
  },
];

export const featurePath = (slug: string) => `/features/${slug}`;

export function feature(slug: string): Feature {
  const f = FEATURES.find((x) => x.slug === slug);
  if (!f) throw new Error(`no feature "${slug}" in lib/features.tsx`);
  return f;
}

const templatesOf = (f: Feature): SiteTemplate[] => f.templates.map(templateById);

// Every listed template must exist (checked once, when the site is built).
for (const f of FEATURES) templatesOf(f);

/** A feature's templates as cards with their previews. */
export function FeatureTemplates({ slug }: { slug: string }) {
  return <TemplateCards templates={templatesOf(feature(slug))} />;
}

/** The other feature pages, for the end of a feature page. */
export function OtherFeatures({ slug }: { slug: string }) {
  return (
    <ul className="checks checks--yes">
      {FEATURES.filter((f) => f.slug !== slug).map((f) => (
        <li key={f.slug}>
          <a href={featurePath(f.slug)}>{f.name}</a>: {f.summary}
        </li>
      ))}
    </ul>
  );
}
