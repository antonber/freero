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
const UPDATED = '2026-11-09';

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
  ];
}

/** Two things to ask an agent on this board, written from the template's own parts, so no two template pages read alike. */
function agentPrompts(t: SiteTemplate): Array<{ prompt: string; outcome: string }> {
  // Only short, plain part titles read well inside a prompt.
  const usable = t.parts.map((p) => p.title).filter((x) => x.length <= 40 && !/[…?(]/.test(x));
  const [first, ...rest] = usable;
  const last = rest.at(-1);
  return [
    {
      prompt: first ? `Fill in ‘${first}’ on the ${t.name} board from these notes.` : `Fill in the ${t.name} board from these notes.`,
      outcome: 'It proposes sticky notes for that part; nothing lands until someone accepts them.',
    },
    {
      prompt: last ? `Turn what we wrote under ‘${last}’ into task cards.` : 'Group what we wrote into themes and list the actions.',
      outcome: 'It proposes the cards, labelled with its name and yours.',
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
              <figcaption>The {t.name} template as it lands on your board.</figcaption>
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

        <Section id="agents" title={`The ${t.name} template with an AI agent`} narrow>
          <Prompts items={agentPrompts(t)} />
          <p>
            Connect <a href="/claude">Claude</a>, <a href="/chatgpt">ChatGPT</a> or <a href="/agents">any MCP client</a>; invite people or share a link to work on it live.
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
