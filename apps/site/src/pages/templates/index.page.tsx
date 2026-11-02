// /templates — the hub of the template catalog: every category with its count and a few of its
// templates (with their previews), each leading to the category's own pages, which list all of
// them (lib/templateCategories.tsx). What the hub shows grows with the number of categories, never
// with the catalog.
import { ButtonLink, Hero, Section } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP } from '../../lib/site';
import { SITE_TEMPLATES, TemplateCards } from '../../lib/templates';
import { categoriesItemList, CategoryLinks, categoryPath, SITE_CATEGORIES } from '../../lib/templateCategories';
import { USE_CASES, useCasePath } from '../../lib/useCases';

export default definePage({
  path: '/templates',
  name: 'Templates',
  title: 'Free whiteboard templates: retros, kanban, roadmaps and more',
  ogTitle: `${SITE_TEMPLATES.length} free whiteboard templates`,
  description: `${SITE_TEMPLATES.length} free, editable whiteboard templates for retrospectives, planning, strategy, research, diagrams and AI agents. Start a board from any of them.`,
  updated: '2026-11-02',
  sitemap: 'templates',
  jsonLd: [categoriesItemList()],
  faq: [
    {
      q: 'Are the templates free?',
      a: 'Yes. Every template is part of Freero, which is free and open source: no paid tier, no template store. Use any of them on as many boards as you like.',
    },
    {
      q: 'Can I change a template after adding it?',
      a: 'Yes. A template is ordinary board content: sticky notes, shapes, text, tables and cards you can edit, move, delete or add to. Adding it is one undo step.',
    },
    {
      q: 'Can I save my own templates?',
      a: 'Yes. Save a whole board from the board menu, or a selection from its right-click menu, as a template. It is yours to reuse, and you can share it with a team workspace you belong to.',
    },
  ],
  body: () => (
    <>
      <Hero
        kicker="Templates"
        title="Free whiteboard templates"
        lead={`${SITE_TEMPLATES.length} original templates for running a retro, planning a sprint, mapping a strategy or briefing an AI agent. Each one lands on your board as editable notes, shapes and tables, with a line that says how to use it.`}
        actions={
          <>
            <ButtonLink href={APP.signup}>Start free</ButtonLink>
            <ButtonLink href="#use-cases" variant="secondary">
              Browse by use case
            </ButtonLink>
          </>
        }
      />
      <Section id="categories" title="Browse by category" lead="Every category lists all of its templates. A template can sit in more than one.">
        <CategoryLinks />
      </Section>
      {SITE_CATEGORIES.map((c, i) => (
        <Section key={c.id} id={`category-${c.id}`} title={<a className="tpl-heading-link" href={categoryPath(c)}>{c.heading}</a>} lead={c.intro} tone={i % 2 ? 'plain' : 'tint'}>
          <TemplateCards templates={c.highlights} />
          <p className="tpl-more">
            <a href={categoryPath(c)}>
              See all {c.templates.length} {c.noun} templates
            </a>
          </p>
        </Section>
      ))}
      <Section id="use-cases" title="Templates by use case" tone={SITE_CATEGORIES.length % 2 ? 'plain' : 'tint'} narrow>
        <ul className="checks checks--yes">
          {USE_CASES.map((u) => (
            <li key={u.slug}>
              <a href={useCasePath(u.slug)}>{u.name}</a>: {u.summary}
            </li>
          ))}
        </ul>
      </Section>
    </>
  ),
});
