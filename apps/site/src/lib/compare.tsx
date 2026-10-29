// "Freero vs <competitor>" pages at /vs/<slug>: one typed definition per competitor, one template.
// Comparative claims must be truthful and verifiable, so every competitor cell names its sources,
// every source has the date it was checked, the page shows when it was last checked and how to
// report a mistake, and an unpublished comparison is noindex, out of the sitemap and linked from
// nowhere. Facts come only from the sourced tables of docs/marketing/competitors/<name>.md;
// anything on a sheet's "Could not verify" list is never published.
import type { ReactNode } from 'react';
import { Card, Cards, Checks, Container, Hero, Section, Table } from '../components/ui';
import { definePage, type FaqItem, type PageDef } from './define';
import { docsUrl, SOURCE_REPO } from './site';

export type Verdict = 'yes' | 'no' | 'partial' | 'paid' | 'unverified';

export interface CompetitorCell {
  verdict: Verdict;
  /** Short qualifier: "Business plan and up", "3 editable boards". */
  note?: string;
  /** Ids of `sources`. Required for every verdict except 'unverified'. */
  sources: string[];
}

export interface FreeroCell {
  verdict: Exclude<Verdict, 'paid' | 'unverified'>;
  note?: string;
  /** The repo file that documents it ('docs/mcp.md'); the site tests check that it exists. */
  ref: string;
}

export interface ComparisonRow {
  capability: string;
  competitor: CompetitorCell;
  freero: FreeroCell;
}

export interface Source {
  id: string;
  title: string;
  url: string;
  /** YYYY-MM-DD */
  checked: string;
}

/** Links the given sources as [n]; an id that isn't in `sources` fails the build. */
export type Cite = (...ids: string[]) => ReactNode;

/** Prose around the table: a retirement timeline, how to move content over. Facts in it are cited. */
export interface ComparisonSection {
  id: string;
  title: string;
  lead?: string;
  /** 'intro': between the summary and the table, for what a reader must know first. Default 'after' the strengths. */
  placement?: 'intro' | 'after';
  body: (cite: Cite) => ReactNode;
}

export interface ComparisonDef {
  slug: string;
  /** The competitor's product name, as plain text (nominative use only: no logo, no styling). */
  competitor: string;
  /** Its column heading when the name alone would mislead ("Jamboard (until 2024)"). */
  column?: string;
  /** Last date every fact on the page was checked, YYYY-MM-DD. */
  checked: string;
  /** Page <title> and meta description (limits as for every page). */
  title: string;
  description: string;
  /** Two or three sentences: what each product is, without judgement. */
  summary: string;
  /** Honest list: where the competitor is the better choice. */
  competitorStronger: string[];
  /** Heading over that list (default "Choose <competitor> if"). */
  competitorStrongerTitle?: string;
  freeroStronger: string[];
  rows: ComparisonRow[];
  sections?: ComparisonSection[];
  sources: Source[];
  faq?: FaqItem[];
  /** The page's own trademark sentence (default "<competitor> is a trademark of its owner."); a line on other names and non-affiliation follows it. */
  trademark?: string;
  /** false until the facts are checked and the page reviewed: noindex, no sitemap, no links. */
  published: boolean;
}

const VERDICT_TEXT: Record<Verdict, string> = {
  yes: 'Yes',
  no: 'No',
  partial: 'Partly',
  paid: 'Paid plans',
  unverified: 'Not checked',
};

/** Problems that keep a comparison from being published (the build refuses a published page with any). */
export function comparisonProblems(c: ComparisonDef): string[] {
  const ids = new Set(c.sources.map((s) => s.id));
  const out: string[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.checked)) out.push(`checked date "${c.checked}" is not YYYY-MM-DD`);
  for (const r of c.rows) {
    if (r.competitor.verdict === 'unverified') out.push(`"${r.capability}": the ${c.competitor} cell is not verified`);
    else if (!r.competitor.sources.length) out.push(`"${r.capability}": the ${c.competitor} cell has no source`);
    for (const s of r.competitor.sources) if (!ids.has(s)) out.push(`"${r.capability}": unknown source ${s}`);
  }
  for (const s of c.sources) if (!/^\d{4}-\d{2}-\d{2}$/.test(s.checked)) out.push(`source ${s.id} has no check date`);
  return out;
}

/** The published comparisons of a build, by competitor name: what the /vs index and each page's "more comparisons" list. */
export function publishedComparisons(pages: PageDef[], except?: string): PageDef[] {
  return pages.filter((p) => p.path.startsWith('/vs/') && p.index !== false && p.path !== except).sort((a, b) => a.name.localeCompare(b.name));
}

function cell(text: string, note?: string, refs?: ReactNode) {
  return (
    <>
      <strong>{text}</strong>
      {note ? <> · {note}</> : null}
      {refs ? <> {refs}</> : null}
    </>
  );
}

const MORE_ABOUT_FREERO: Array<[string, string]> = [
  ['/agents', 'Agents, MCP, the API and webhooks'],
  ['/claude', 'Freero for Claude'],
  ['/chatgpt', 'Freero for ChatGPT'],
  ['/open-source', 'Self-hosting and the MIT licence'],
  ['/security', 'Security, SSO and the audit log'],
  ['/pricing', 'Pricing and default limits'],
];

export function defineComparison(c: ComparisonDef): PageDef {
  const problems = comparisonProblems(c);
  if (c.published && problems.length) throw new Error(`/vs/${c.slug} can't be published:\n  ${problems.join('\n  ')}`);
  const sourceNo = new Map(c.sources.map((s, i) => [s.id, i + 1]));
  const cite: Cite = (...ids) =>
    ids.map((id) => {
      const n = sourceNo.get(id);
      if (!n) throw new Error(`/vs/${c.slug} cites unknown source ${id}`);
      return (
        <a key={id} className="cite" href={`#source-${id}`} aria-label={`Source ${n}`}>
          [{n}]
        </a>
      );
    });
  const sections = (placement: 'intro' | 'after') =>
    (c.sections ?? [])
      .filter((s) => (s.placement ?? 'after') === placement)
      .map((s) => (
        <Section key={s.id} id={s.id} title={s.title} lead={s.lead} narrow>
          {s.body(cite)}
        </Section>
      ));
  const pagePath = `/vs/${c.slug}`;
  return definePage({
    path: pagePath,
    name: `Freero vs ${c.competitor}`,
    title: c.title,
    description: c.description,
    ogTitle: `Freero vs ${c.competitor}`,
    updated: c.checked,
    index: c.published,
    sitemap: 'compare',
    faq: c.faq,
    body: ({ pages }) => {
      const others = publishedComparisons(pages, pagePath);
      return (
        <>
          <Hero kicker="Comparison" title={`Freero vs ${c.competitor}`} lead={c.summary}>
            <p className="works-with">
              Last checked <time dateTime={c.checked}>{c.checked}</time> from public sources, listed at the <a href="#sources">end of this page</a>.
            </p>
          </Hero>
          {sections('intro')}
          <Section id="at-a-glance" title="At a glance" lead="Each cell links to where the fact comes from: a numbered public source for the other product, Freero’s documentation for Freero.">
            <Table
              stack
              caption={`Freero and ${c.competitor} compared, checked ${c.checked}`}
              head={['Capability', c.column ?? c.competitor, 'Freero']}
              rows={c.rows.map((r) => [r.capability, cell(VERDICT_TEXT[r.competitor.verdict], r.competitor.note, cite(...r.competitor.sources)), cell(VERDICT_TEXT[r.freero.verdict], r.freero.note, <a className="cite" href={docsUrl(r.freero.ref)} aria-label={`Freero documentation: ${r.freero.ref}`}>[docs]</a>)])}
            />
          </Section>
          <Section id="strengths" tone="tint" title="Where each one is stronger">
            <div className="columns-2">
              <div>
                <h3>{c.competitorStrongerTitle ?? `Choose ${c.competitor} if`}</h3>
                <Checks kind="yes" items={c.competitorStronger} />
              </div>
              <div>
                <h3>Choose Freero if</h3>
                <Checks kind="yes" items={c.freeroStronger} />
              </div>
            </div>
          </Section>
          {sections('after')}
          <Section id="more" tone="tint" title="Keep reading">
            <div className="columns-2">
              <div>
                <h3>More about Freero</h3>
                <ul>
                  {MORE_ABOUT_FREERO.map(([href, label]) => (
                    <li key={href}>
                      <a href={href}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
              {others.length ? (
                <div>
                  <h3>Other comparisons</h3>
                  <ul>
                    {others.map((p) => (
                      <li key={p.path}>
                        <a href={p.path}>{p.name}</a>
                      </li>
                    ))}
                    <li>
                      <a href="/vs">All comparisons</a>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
          </Section>
          <section id="sources" className="section section--plain" aria-labelledby="sources-title">
            <Container narrow>
              <h2 id="sources-title">Sources and dates</h2>
              <ol className="sources">
                {c.sources.map((s) => (
                  <li key={s.id} id={`source-${s.id}`}>
                    <a href={s.url} rel="nofollow noopener">
                      {s.title}
                    </a>
                    , checked <time dateTime={s.checked}>{s.checked}</time>
                  </li>
                ))}
              </ol>
              <p>
                Facts about Freero come from its documentation and code. Prices and plans change: check the vendor’s own page before you decide. Spotted a
                mistake? <a href={`${SOURCE_REPO}/issues`}>Tell us</a> and we will correct it.
              </p>
              <p className="footer__note">
                {c.trademark ?? `${c.competitor} is a trademark of its owner.`} Other product names on this page are trademarks of their respective owners, used
                only to identify their products. Freero is not affiliated with or endorsed by any of them.
              </p>
            </Container>
          </section>
        </>
      );
    },
  });
}

/** The /vs index: every published comparison, found from the build's pages (no list to keep). */
export function ComparisonCards({ pages }: { pages: PageDef[] }) {
  return (
    <Cards cols={2}>
      {publishedComparisons(pages).map((p) => (
        <Card key={p.path} title={p.name} href={p.path}>
          <p>{p.description}</p>
        </Card>
      ))}
    </Cards>
  );
}
