// /templates/<id> — one page per template in the app's catalog (lib/templates.tsx reads it): what
// it is for, how to use it (the board's own instruction and the parts it lays out), its real
// preview, "Use this template" (sign up, then a new board with it), related templates from its
// category and use cases. Its breadcrumb runs through its (first) category's page. A template added
// to the catalog gets its page with no edit here.
import { ButtonLink, Hero, Prompts, Section, Step, Steps } from '../../components/ui';
import { definePage, type PageDef } from '../../lib/define';
import { abs } from '../../lib/site';
import { categoryPath, siteCategory } from '../../lib/templateCategories';
import {
  clip,
  previewOf,
  relatedTo,
  SITE_TEMPLATES,
  TemplateCards,
  templatePath,
  TemplatePreviewImage,
  useTemplateHref,
  type SiteTemplate,
} from '../../lib/templates';
import { useCasePath, useCasesFor } from '../../lib/useCases';

/** When the content of these pages last changed meaningfully (their sitemap lastmod). */
const UPDATED = '2026-10-30';

const baseName = (t: SiteTemplate) => (/template$/i.test(t.name) ? t.name : `${t.name} template`);

/** A title of at most 60 characters that leads with "<name> template", unique across the catalog. */
function titles(): Map<string, string> {
  const pick = (t: SiteTemplate, qualifier?: string) => {
    const base = qualifier ? `${baseName(t)} for ${qualifier}` : baseName(t);
    return [`${base}: free online whiteboard`, `${base}, free and editable`, `${base} | Freero`, base].find((c) => c.length <= 60) ?? clip(base, 60);
  };
  const out = new Map(SITE_TEMPLATES.map((t) => [t.id, pick(t)]));
  // Two templates with one name (in different categories) say which is which.
  for (const t of SITE_TEMPLATES) if (SITE_TEMPLATES.some((o) => o.id !== t.id && out.get(o.id) === out.get(t.id))) out.set(t.id, pick(t, siteCategory(t.category).noun));
  return out;
}

function descriptionOf(t: SiteTemplate): string {
  const own = `${t.description} Free and editable on a Freero board.`;
  return own.length <= 155 ? own : clip(t.description, 155);
}

/** schema.org HowTo for a template's steps (the same steps the page shows). */
function howTo(t: SiteTemplate, steps: Array<{ name: string; text: string }>): Record<string, unknown> {
  const url = abs(templatePath(t.id));
  return {
    '@type': 'HowTo',
    '@id': `${url}#how`,
    name: `How to use the ${t.name} template`,
    description: t.description,
    image: abs(previewOf(t).src),
    step: steps.map((s, n) => ({ '@type': 'HowToStep', position: n + 1, name: s.name, text: s.text, url: `${url}#how` })),
  };
}

function stepsOf(t: SiteTemplate): Array<{ name: string; text: string }> {
  return [
    { name: 'Start a board from it', text: `Use this template opens a new Freero board with the ${t.name} template on it (sign up free first). On a board you already have, open Templates in the toolbar and search for “${t.name}”.` },
    ...(t.hint ? [{ name: 'Follow the instruction on the board', text: t.hint }] : []),
    ...(t.parts.length ? [{ name: 'Fill in each part', text: t.parts.map((p) => (p.detail ? `${p.title}: ${p.detail}` : p.title)).join(' · ') }] : []),
    {
      name: 'Bring your team and your agents',
      text: 'Invite people to the board or share a link, and work on it together live. The timer is in the top bar, private mode and voting in the board menu, and Claude or ChatGPT can join through Freero’s MCP server.',
    },
  ];
}

const pageTitles = titles();

const page = (t: SiteTemplate): PageDef => {
  const category = siteCategory(t.category);
  const related = relatedTo(t);
  const useCases = useCasesFor(t.id);
  const steps = stepsOf(t);
  return definePage({
    path: templatePath(t.id),
    name: t.name,
    parent: categoryPath(category),
    title: pageTitles.get(t.id)!,
    description: descriptionOf(t),
    updated: UPDATED,
    sitemap: 'templates',
    sharedOg: { key: `templates-${category.id}`, kicker: 'Free templates', title: category.heading },
    jsonLd: [howTo(t, steps)],
    body: () => (
      <>
        <Hero
          kicker={category.heading.replace(/s$/, '')}
          title={baseName(t)}
          lead={t.description}
          actions={
            <>
              <ButtonLink href={useTemplateHref(t.id)}>Use this template</ButtonLink>
              <ButtonLink href={categoryPath(category)} variant="secondary">
                More {category.noun} templates
              </ButtonLink>
            </>
          }
          aside={
            <figure className="tpl-hero">
              <TemplatePreviewImage t={t} eager />
              <figcaption>The template as it lands on your board, drawn from the template itself. Every part is editable.</figcaption>
            </figure>
          }
        >
          <p className="works-with">
            Free · Editable · Works with Claude and ChatGPT
            {t.categories.length > 1 ? (
              <>
                {' · Also in '}
                {t.categories.slice(1).map((c, i) => (
                  <span key={c.id}>
                    {i ? ', ' : ''}
                    <a href={categoryPath(siteCategory(c))}>{c.label}</a>
                  </span>
                ))}
              </>
            ) : null}
          </p>
        </Hero>

        <Section id="how" title={`How to use the ${t.name} template`} tone="tint" narrow>
          <Steps>
            {steps.map((s) =>
              s.name === 'Fill in each part' ? (
                <Step key={s.name} title={s.name}>
                  <ul className="tpl-parts">
                    {t.parts.map((p) => (
                      <li key={`${p.title}-${p.detail ?? ''}`}>
                        <strong>{p.title}</strong>
                        {p.detail ? <> {p.detail}</> : null}
                      </li>
                    ))}
                  </ul>
                </Step>
              ) : (
                <Step key={s.name} title={s.name}>
                  <p>{s.name === 'Follow the instruction on the board' ? `“${s.text}”` : s.text}</p>
                </Step>
              ),
            )}
          </Steps>
          <p>
            <ButtonLink href={useTemplateHref(t.id)}>Use this template</ButtonLink>
          </p>
        </Section>

        <Section id="agents" title="Work on it with an AI agent" lead="Connect an assistant once and it works on the board with you, with your permissions: by default it reads and proposes, and people decide." narrow>
          <Prompts
            items={[
              {
                prompt: `Fill in the ${t.name} board from these notes.`,
                outcome: 'It reads the board, then proposes sticky notes for it. Nothing changes until someone on the board accepts them.',
              },
              {
                prompt: 'Group what we wrote into themes and list the actions.',
                outcome: 'It proposes clusters with a title each and task cards for the actions, labelled with its name and yours.',
              },
            ]}
          />
          <p>
            Set it up for <a href="/claude">Claude</a>, <a href="/chatgpt">ChatGPT</a> or <a href="/agents">any MCP client</a>.
          </p>
        </Section>

        {useCases.length ? (
          <Section id="use-cases" title="Used for" narrow>
            <ul className="checks checks--yes">
              {useCases.map((u) => (
                <li key={u.slug}>
                  <a href={useCasePath(u.slug)}>{u.name}</a>: {u.summary}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        {related.length ? (
          <Section id="related" title={`Related ${category.noun} templates`} tone="tint">
            <TemplateCards templates={related} />
            <p className="tpl-more">
              <a href={categoryPath(category)}>
                All {category.templates.length} {category.noun} templates
              </a>
              {' · '}
              <a href="/templates">All {SITE_TEMPLATES.length} templates by category</a>
            </p>
          </Section>
        ) : null}
      </>
    ),
  });
};

export default SITE_TEMPLATES.map(page);
