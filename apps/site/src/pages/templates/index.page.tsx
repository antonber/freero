// /templates — every template in the app's catalog, by category (each under its first one, as the
// board's Templates panel lists them), each card with the template's real preview.
import { ButtonLink, Hero, Section } from '../../components/ui';
import { definePage } from '../../lib/define';
import { APP } from '../../lib/site';
import { categoryAnchor, SITE_TEMPLATES, TEMPLATE_CATEGORIES, TemplateCards, templatesIn, templatesItemList } from '../../lib/templates';
import { USE_CASES, useCasePath } from '../../lib/useCases';

const categories = TEMPLATE_CATEGORIES.filter((c) => templatesIn(c.id).length);

export default definePage({
  path: '/templates',
  name: 'Templates',
  title: 'Free whiteboard templates: retros, kanban, roadmaps and more',
  ogTitle: `${SITE_TEMPLATES.length} free whiteboard templates`,
  description: `${SITE_TEMPLATES.length} free, editable whiteboard templates for retrospectives, planning, strategy, research, diagrams and AI agents. Start a board from any of them.`,
  updated: '2026-10-30',
  sitemap: 'templates',
  jsonLd: [templatesItemList()],
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
      >
        <p className="works-with">
          Jump to:{' '}
          {categories.map((c, i) => (
            <span key={c.id}>
              {i ? ' · ' : ''}
              <a href={`#${categoryAnchor(c.id)}`}>{c.label}</a>
            </span>
          ))}
        </p>
      </Hero>
      {categories.map((c, i) => (
        <Section key={c.id} id={categoryAnchor(c.id)} title={c.label} tone={i % 2 ? 'tint' : 'plain'}>
          <TemplateCards templates={templatesIn(c.id)} />
        </Section>
      ))}
      <Section id="use-cases" title="Templates by use case" tone={categories.length % 2 ? 'tint' : 'plain'} narrow>
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
