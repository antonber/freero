// /templates/category/<slug> — one page per category of the app's template catalog
// (lib/templateCategories.tsx): its intro, every template that names it with its preview, and the
// other categories. Past CATEGORY_PAGE_SIZE templates the list continues on /<slug>/2, /3…, each a
// page of its own (own title, canonical and sitemap entry), so no page grows with the catalog.
import { ButtonLink, Hero, Section } from '../../components/ui';
import { definePage, type PageDef } from '../../lib/define';
import { abs, APP } from '../../lib/site';
import { clip, TemplateCards } from '../../lib/templates';
import { CATEGORY_PAGE_SIZE, CategoryLinks, categoryPath, pageCount, SITE_CATEGORIES, templateItemList, templatesOnPage, type SiteCategory } from '../../lib/templateCategories';

/** When the copy of these pages last changed meaningfully (their sitemap lastmod). */
const UPDATED = '2026-11-02';

function Pager({ c, page }: { c: SiteCategory; page: number }) {
  const pages = pageCount(c);
  if (pages < 2) return null;
  return (
    <nav className="pager" aria-label={`Pages of ${c.heading.toLowerCase()}`}>
      {page > 1 ? (
        <a className="pager__step" href={categoryPath(c, page - 1)} rel="prev">
          Previous
        </a>
      ) : null}
      <ol>
        {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
          <li key={n}>
            {n === page ? (
              <span aria-current="page">{n}</span>
            ) : (
              <a href={categoryPath(c, n)} aria-label={`Page ${n}`}>
                {n}
              </a>
            )}
          </li>
        ))}
      </ol>
      {page < pages ? (
        <a className="pager__step" href={categoryPath(c, page + 1)} rel="next">
          Next
        </a>
      ) : null}
    </nav>
  );
}

const page = (c: SiteCategory, n: number): PageDef => {
  const pages = pageCount(c);
  const shown = templatesOnPage(c, n);
  const total = c.templates.length;
  const path = categoryPath(c, n);
  // The longest that fits: the count grows with the catalog, so the closing sentence goes first.
  const what = `${total} free ${c.noun} templates for ${c.summary}.`;
  const longest = n > 1 ? `Page ${n} of ${pages}: ${what}` : `${what} Edit them together on a Freero board.`;
  const description = [longest, ...(n > 1 ? [] : [what])].find((d) => d.length <= 155) ?? clip(longest, 155);
  return definePage({
    path,
    name: n > 1 ? `Page ${n}` : c.heading,
    title: n > 1 ? `${c.heading}, page ${n} | Freero` : c.title,
    description,
    updated: UPDATED,
    sitemap: 'templates',
    sharedOg: { key: `templates-${c.id}`, kicker: 'Free templates', title: c.heading },
    jsonLd: [templateItemList(abs(path), c.heading, shown, (n - 1) * CATEGORY_PAGE_SIZE)],
    body: () => (
      <>
        <Hero
          kicker="Templates"
          title={n > 1 ? `${c.heading}, page ${n}` : c.heading}
          lead={c.intro}
          actions={
            <>
              <ButtonLink href={APP.signup}>Start free</ButtonLink>
              <ButtonLink href="/templates" variant="secondary">
                All categories
              </ButtonLink>
            </>
          }
        >
          <p className="works-with">
            {total} free {total === 1 ? 'template' : 'templates'} · Editable · Works with Claude and ChatGPT
            {pages > 1 ? ` · Page ${n} of ${pages}` : ''}
          </p>
        </Hero>
        <Section
          id="templates"
          title={pages > 1 ? `${c.heading} ${(n - 1) * CATEGORY_PAGE_SIZE + 1}–${(n - 1) * CATEGORY_PAGE_SIZE + shown.length} of ${total}` : `All ${total} ${c.noun} templates`}
          tone="tint"
        >
          <TemplateCards templates={shown} />
          <Pager c={c} page={n} />
        </Section>
        <Section id="categories" title="More template categories">
          <CategoryLinks except={c.id} />
        </Section>
      </>
    ),
  });
};

export default SITE_CATEGORIES.flatMap((c) => Array.from({ length: pageCount(c) }, (_, i) => page(c, i + 1)));
