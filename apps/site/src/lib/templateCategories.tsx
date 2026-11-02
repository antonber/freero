// The template catalog by category: /templates/category/<slug> (and /<slug>/<n> once a category
// outgrows one page) for every category the app's catalog uses, and what the /templates hub shows
// of each. Which templates belong where comes from the catalog's own metadata (every category a
// template names, its first one first); the site adds only what a page needs that the app doesn't
// have: a stable URL slug, a title and an intro written for that category. A category the app adds
// without copy here fails the build, naming this file.
import { abs } from './site';
import { SITE_TEMPLATES, TEMPLATE_CATEGORIES, templatePath, type SiteTemplate, type TemplateCategory } from './templates';
import { USE_CASES } from './useCases';

interface CategoryCopy {
  /** The URL segment: stable, so it never follows a label change in the app. */
  slug: string;
  /** "<n> free <noun> templates" in the description and links. */
  noun: string;
  /** <title>, at most 60 characters. */
  title: string;
  /** What the templates are for, finishing "<n> free <noun> templates for …" (the meta description). */
  summary: string;
  /** The page's lead and the hub's line under the category. */
  intro: string;
}

/** Keyed by the app's category id (features/templates/lib/types.ts CATEGORIES). */
const COPY: Partial<Record<string, CategoryCopy>> = {
  brainstorm: {
    slug: 'brainstorming',
    noun: 'brainstorming',
    title: 'Free brainstorming templates for online whiteboards',
    summary: 'generating, sorting and voting on ideas: SCAMPER, how might we, brainwriting',
    intro: 'Get many ideas out fast, then narrow them down. Each board gives the group a prompt to write against, room to cluster what came up and a way to vote on what to try first.',
  },
  icebreakers: {
    slug: 'team-building',
    noun: 'team building',
    title: 'Free icebreaker and team building templates',
    summary: 'check-in and check-out rounds, icebreaker games and team appreciation',
    intro: 'Short activities that warm a group up or close a session well: check-in and check-out rounds, games that get people talking, and boards for saying thanks. Most take ten minutes or less.',
  },
  meetings: {
    slug: 'meetings',
    noun: 'meeting',
    title: 'Free meeting templates: agendas, notes and decisions',
    summary: 'agendas, shared notes, decision logs and facilitating workshops and 1:1s',
    intro: 'Run a meeting from agenda to decision: notes everyone adds to at once, a parking lot for side topics, voting and consent rounds, and a log of what was decided and who owns it.',
  },
  agile: {
    slug: 'agile',
    noun: 'agile',
    title: 'Free agile templates: sprints, retros and kanban',
    summary: 'sprint planning, standups, kanban boards and dozens of retrospective formats',
    intro: 'What a team reaches for across a sprint: planning and capacity, a board to track the work, standups and reviews, and enough retrospective formats to keep every retro fresh.',
  },
  product: {
    slug: 'product-management',
    noun: 'product management',
    title: 'Free product management templates for whiteboards',
    summary: 'requirements, prioritisation, discovery, product metrics and launches',
    intro: 'From a customer problem to a shipped feature: write the requirements, prioritise with RICE, Kano or MoSCoW, map opportunities and assumptions, define the metrics and plan the launch.',
  },
  design: {
    slug: 'design',
    noun: 'design',
    title: 'Free design templates: critiques, flows and design sprints',
    summary: 'user flows, design critiques, usability tests, design sprints and design QA',
    intro: 'Boards for the work around the design itself: map a user flow, run a critique or a five-day sprint, plan a usability test and read it out, and check accessibility and quality before release.',
  },
  research: {
    slug: 'ux-research',
    noun: 'UX research',
    title: 'Free UX research templates: journeys, personas and more',
    summary: 'research plans, interview guides, journey maps, personas and synthesis',
    intro: 'Plan a study, recruit for it, run the interviews and turn the notes into findings. Journey maps, empathy maps, personas and service blueprints keep what you learned in front of the team.',
  },
  strategy: {
    slug: 'strategy',
    noun: 'strategy',
    title: 'Free strategy templates: SWOT, OKRs, roadmaps and more',
    summary: 'SWOT, OKRs, roadmaps, business models and competitive analysis',
    intro: 'Decide where to play and how to win on one board everyone can see: read the situation, weigh options and bets, set objectives and lay out the roadmap that follows from them.',
  },
  consulting: {
    slug: 'consulting',
    noun: 'consulting',
    title: 'Free consulting framework templates for whiteboards',
    summary: 'issue trees, hypotheses, PESTLE, five forces, scenarios and value chains',
    intro: 'Frameworks for structuring a problem and the analysis behind a recommendation: break the question down, track hypotheses, scan the environment and compare scenarios with the client in the room.',
  },
  sales: {
    slug: 'sales-marketing',
    noun: 'sales and marketing',
    title: 'Free sales and marketing templates for whiteboards',
    summary: 'campaigns, positioning, content calendars, pipeline and account reviews',
    intro: 'Plan a campaign, sharpen positioning and messaging, schedule content, then review the pipeline, deals and key accounts. For marketing and sales teams that plan together.',
  },
  people: {
    slug: 'hr',
    noun: 'HR',
    title: 'Free HR templates: hiring, onboarding and team health',
    summary: 'hiring, onboarding, feedback conversations, career growth and team health',
    intro: 'For managers and people teams: hire against a clear scorecard, welcome new starters, prepare feedback and performance conversations, map skills and career steps, and check how the team is doing.',
  },
  operations: {
    slug: 'operations',
    noun: 'operations',
    title: 'Free operations templates: processes, risks and handovers',
    summary: 'process maps, root-cause analysis, risk registers and continuous improvement',
    intro: 'Map how work flows today, find where it breaks and fix the cause: value streams, process maps, five whys and failure modes, risk registers, and handovers for the day to day.',
  },
  planning: {
    slug: 'planning',
    noun: 'planning',
    title: 'Free planning templates: timelines, Gantt charts and OKRs',
    summary: 'project timelines, Gantt charts, milestones, budgets and status reports',
    intro: 'Lay out who does what by when: project charters and timelines, Gantt charts and milestones, OKR trees, budgets, and status reports that keep everyone up to date.',
  },
  personal: {
    slug: 'personal',
    noun: 'personal planning',
    title: 'Free personal planning templates: goals, habits, reviews',
    summary: 'weekly reviews, goals, habits, reading lists and thinking through decisions',
    intro: 'Boards for your own week and your own goals: plan and review the week, track habits, sort tasks by urgency, keep a reading list and think a decision through before you make it.',
  },
  diagramming: {
    slug: 'diagrams',
    noun: 'diagram',
    title: 'Free diagram templates: flowcharts, org charts and more',
    summary: 'flowcharts, org charts, swimlane processes, sitemaps and system diagrams',
    intro: 'Start a diagram from a layout that is already connected: flowcharts and swimlane processes, org charts, sitemaps and Venn diagrams, made of ordinary shapes and connectors you can rearrange.',
  },
  engineering: {
    slug: 'engineering',
    noun: 'software engineering',
    title: 'Free software engineering templates for whiteboards',
    summary: 'architecture diagrams, design docs, incident reviews and release checks',
    intro: 'Sketch a system and its data, write the design and the decision behind it, run an incident from timeline to postmortem, and plan migrations, rollouts and on-call handovers together.',
  },
  ai: {
    slug: 'ai-agents',
    noun: 'AI and agent',
    title: 'Free AI and agent workflow templates',
    summary: 'designing and briefing agents, reviewing their runs and evals, and AI risk',
    intro: 'Decide where AI helps and keep people in charge of it: design an agent workflow and its permissions, brief an agent, review its runs and evals, and agree a use policy. Agents connected to Freero work on these boards with you.',
  },
  education: {
    slug: 'education',
    noun: 'classroom',
    title: 'Free classroom templates for teachers and students',
    summary: 'lesson plans, KWL charts, concept maps, exit tickets and group work',
    intro: 'For teachers and students: plan lessons and units, start from what the class already knows, map concepts, run discussions and group work, and check understanding with exit tickets and rubrics.',
  },
};

/** Templates per listing page: a category page never grows past this, the rest go on /<slug>/2, /3… */
export const CATEGORY_PAGE_SIZE = 60;
/** Templates the hub shows under each category (with their previews). */
export const HUB_HIGHLIGHTS = 4;

export interface SiteCategory extends TemplateCategory, CategoryCopy {
  /** "<Noun> templates": the h1, breadcrumb and Open Graph title. */
  heading: string;
  /** Every template that names this category: those listed under it first (their first category), then the rest. */
  templates: SiteTemplate[];
  /** The first few, shown on the hub. */
  highlights: SiteTemplate[];
}

export const categoryPath = (c: { slug: string }, page = 1) => `/templates/category/${c.slug}${page > 1 ? `/${page}` : ''}`;
export const pageCount = (c: SiteCategory) => Math.max(1, Math.ceil(c.templates.length / CATEGORY_PAGE_SIZE));
export const templatesOnPage = (c: SiteCategory, page: number) => c.templates.slice((page - 1) * CATEGORY_PAGE_SIZE, page * CATEGORY_PAGE_SIZE);

/** Templates the use cases name, in their order: the catalog's most used, highlighted first. */
const featured = new Map<string, number>();
for (const id of USE_CASES.flatMap((u) => u.templates)) if (!featured.has(id)) featured.set(id, featured.size);
const rank = (t: SiteTemplate, i: number) => featured.get(t.id) ?? featured.size + i;

/** The categories that have templates, in the app's order. */
export const SITE_CATEGORIES: SiteCategory[] = TEMPLATE_CATEGORIES.flatMap((cat) => {
  const tagged = SITE_TEMPLATES.map((t, i) => ({ t, i })).filter(({ t }) => t.categories.some((c) => c.id === cat.id));
  if (!tagged.length) return [];
  const copy = COPY[cat.id];
  if (!copy) throw new Error(`template category "${cat.id}" has no page copy: add its slug, title and intro to apps/site/src/lib/templateCategories.tsx`);
  const primary = tagged.filter(({ t }) => t.category.id === cat.id).sort((a, b) => rank(a.t, a.i) - rank(b.t, b.i));
  const others = tagged.filter(({ t }) => t.category.id !== cat.id);
  const templates = [...primary, ...others].map(({ t }) => t);
  const heading = `${copy.noun[0].toUpperCase()}${copy.noun.slice(1)} templates`;
  return [{ ...cat, ...copy, heading, templates, highlights: templates.slice(0, HUB_HIGHLIGHTS) }];
});

for (const c of SITE_CATEGORIES)
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(c.slug) || SITE_CATEGORIES.some((o) => o !== c && o.slug === c.slug))
    throw new Error(`template category "${c.id}": slug "${c.slug}" must be URL-safe and unique (apps/site/src/lib/templateCategories.tsx)`);

const byId = new Map(SITE_CATEGORIES.map((c) => [c.id, c]));

/** The site's category for one of a template's categories. */
export function siteCategory(c: TemplateCategory): SiteCategory {
  const sc = byId.get(c.id);
  if (!sc) throw new Error(`template category "${c.id}" has no page`);
  return sc;
}

/** Every category page as a link with its template count (the hub's index, a category page's "more"). */
export function CategoryLinks({ except }: { except?: string }) {
  return (
    <ul className="tpl-cats">
      {SITE_CATEGORIES.filter((c) => c.id !== except).map((c) => (
        <li key={c.id}>
          <a href={categoryPath(c)}>
            <span className="tpl-cats__name">{c.label}</span>
            <span className="tpl-cats__count">{c.templates.length}</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/** schema.org ItemList of some templates (a category page's). */
export function templateItemList(id: string, name: string, templates: readonly SiteTemplate[], offset = 0): Record<string, unknown> {
  return {
    '@type': 'ItemList',
    '@id': `${id}#list`,
    name,
    numberOfItems: templates.length,
    itemListElement: templates.map((t, n) => ({ '@type': 'ListItem', position: offset + n + 1, name: t.name, url: abs(templatePath(t.id)) })),
  };
}

/** schema.org ItemList of the category pages (the hub). */
export function categoriesItemList(): Record<string, unknown> {
  return {
    '@type': 'ItemList',
    '@id': `${abs('/templates')}#categories`,
    name: 'Freero whiteboard templates by category',
    numberOfItems: SITE_CATEGORIES.length,
    itemListElement: SITE_CATEGORIES.map((c, n) => ({ '@type': 'ListItem', position: n + 1, name: c.heading, url: abs(categoryPath(c)) })),
  };
}
