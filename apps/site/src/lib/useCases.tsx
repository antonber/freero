// The use cases (/use-cases/<slug>): one job to be done each, written by hand in its own page file.
// The templates each one uses are listed here, once, so a use-case page shows them and every
// template's page links back to the use cases it belongs to. An id the catalog no longer has fails
// the build (templateById throws).
import { SITE_TEMPLATES, TemplateCards, templateById, type SiteTemplate } from './templates';

export interface UseCase {
  slug: string;
  /** Breadcrumb and card title. */
  name: string;
  /** One line for the index card and a template page's "Used for" list. */
  summary: string;
  /** Catalog template ids, most useful first. */
  templates: string[];
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'retrospectives',
    name: 'Retrospectives',
    summary: 'Guided retros: write alone under a timer, reveal, group, vote and leave with owned actions.',
    templates: ['retrospective', 'retro-start-stop-continue', 'retro-4ls', 'hot-air-balloon-retro', 'rose-thorn-bud', 'team-health-check', 'incident-postmortem'],
  },
  {
    slug: 'planning-poker',
    name: 'Planning poker',
    summary: 'Estimate cards with sealed picks, reveal together and write the agreed value on the card.',
    templates: ['relative-sizing', 'sprint-planning', 'story-map', 'sprint-board', 'quarter-planning'],
  },
  {
    slug: 'workshops',
    name: 'Workshops',
    summary: 'Run a workshop on one board: private writing, dot voting, a shared timer, follow the facilitator.',
    templates: ['workshop-agenda', 'brainstorm', 'how-might-we', 'dot-voting', 'lean-coffee', 'design-sprint', 'decision-matrix', 'icebreaker'],
  },
  {
    slug: 'jira',
    name: 'Jira planning',
    summary: 'Turn sticky notes into Jira issues on Cloud or Data Center, and keep both in step.',
    templates: ['sprint-planning', 'story-map', 'bug-triage', 'kanban', 'team-dependencies', 'retrospective'],
  },
  {
    slug: 'roadmaps',
    name: 'Roadmaps',
    summary: 'A roadmap on a timeline from Jira, Linear or GitHub issues, with bars that sync their dates.',
    templates: ['roadmap', 'now-next-later', 'release-plan', 'gantt-chart', 'quarter-planning', 'okr-tree'],
  },
  {
    slug: 'agent-control-room',
    name: 'Agent control room',
    summary: 'A board where AI agents post their plan, status and tasks, and people steer them.',
    templates: ['agent-control-room', 'agent-task-brief', 'agent-handoff', 'human-agent-workshop', 'eval-review'],
  },
];

export const useCasePath = (slug: string) => `/use-cases/${slug}`;

export function useCase(slug: string): UseCase {
  const u = USE_CASES.find((x) => x.slug === slug);
  if (!u) throw new Error(`no use case "${slug}" in lib/useCases.ts`);
  return u;
}

/** A use case's templates, from the catalog. */
export const templatesOf = (u: UseCase): SiteTemplate[] => u.templates.map(templateById);

/** The use cases a template is listed in. */
export const useCasesFor = (templateId: string): UseCase[] => USE_CASES.filter((u) => u.templates.includes(templateId));

// Every listed template must exist (checked once, when the site is built).
for (const u of USE_CASES) templatesOf(u);

/** A use case's templates as cards with their previews, and a link to the whole catalog. */
export function UseCaseTemplates({ slug }: { slug: string }) {
  return (
    <>
      <TemplateCards templates={templatesOf(useCase(slug))} />
      <p>
        <a href="/templates">Browse all {SITE_TEMPLATES.length} templates</a>
      </p>
    </>
  );
}

/** The other use cases, for the end of a use-case page. */
export function OtherUseCases({ slug }: { slug: string }) {
  return (
    <ul className="checks checks--yes">
      {USE_CASES.filter((u) => u.slug !== slug).map((u) => (
        <li key={u.slug}>
          <a href={useCasePath(u.slug)}>{u.name}</a>: {u.summary}
        </li>
      ))}
    </ul>
  );
}
