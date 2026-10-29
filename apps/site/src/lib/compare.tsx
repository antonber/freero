// "Freero vs <competitor>" pages at /vs/<slug>: one typed definition per competitor, one template.
// Comparative claims must be truthful and verifiable, so every competitor cell names its sources,
// every source has the date it was checked, the page shows when it was last checked and how to
// report a mistake, and an unpublished comparison is noindex, out of the sitemap and linked from
// nowhere. Facts come only from the sourced tables of docs/marketing/competitors/<name>.md;
// anything on a sheet's "Could not verify" list is never published.
import type { ReactNode } from 'react';
import { Checks, Container, Hero, Section, Table } from '../components/ui';
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
  /** The repo file that documents it ('docs/mcp.md'). */
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

export interface ComparisonDef {
  slug: string;
  /** The competitor's product name, as plain text (nominative use only: no logo, no styling). */
  competitor: string;
  /** Last date every fact on the page was checked, YYYY-MM-DD. */
  checked: string;
  /** Page <title> and meta description (limits as for every page). */
  title: string;
  description: string;
  /** Two or three sentences: what each product is, without judgement. */
  summary: string;
  /** Honest list: where the competitor is the better choice. */
  competitorStronger: string[];
  freeroStronger: string[];
  rows: ComparisonRow[];
  sources: Source[];
  faq?: FaqItem[];
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

function cell(text: string, note?: string, refs?: ReactNode) {
  return (
    <>
      <strong>{text}</strong>
      {note ? <> · {note}</> : null}
      {refs ? <> {refs}</> : null}
    </>
  );
}

export function defineComparison(c: ComparisonDef): PageDef {
  const problems = comparisonProblems(c);
  if (c.published && problems.length) throw new Error(`/vs/${c.slug} can't be published:\n  ${problems.join('\n  ')}`);
  const sourceNo = new Map(c.sources.map((s, i) => [s.id, i + 1]));
  return definePage({
    path: `/vs/${c.slug}`,
    name: `Freero vs ${c.competitor}`,
    title: c.title,
    description: c.description,
    ogTitle: `Freero vs ${c.competitor}`,
    updated: c.checked,
    index: c.published,
    sitemap: 'compare',
    faq: c.faq,
    body: () => (
      <>
        <Hero kicker="Comparison" title={`Freero vs ${c.competitor}`} lead={c.summary}>
          <p className="works-with">
            Last checked <time dateTime={c.checked}>{c.checked}</time> from public sources, listed at the end of this page.
          </p>
        </Hero>
        <Section id="at-a-glance" title="At a glance" lead="Each cell links to where the fact comes from.">
          <Table
            caption={`Freero and ${c.competitor} compared, checked ${c.checked}`}
            head={['Capability', c.competitor, 'Freero']}
            rows={c.rows.map((r) => [
              r.capability,
              cell(
                VERDICT_TEXT[r.competitor.verdict],
                r.competitor.note,
                r.competitor.sources.map((s) => (
                  <a key={s} href={`#source-${s}`} aria-label={`Source ${sourceNo.get(s)}`}>
                    [{sourceNo.get(s)}]
                  </a>
                )),
              ),
              cell(
                VERDICT_TEXT[r.freero.verdict],
                r.freero.note,
                <a href={docsUrl(r.freero.ref)} aria-label={`Freero documentation: ${r.freero.ref}`}>
                  [docs]
                </a>,
              ),
            ])}
          />
        </Section>
        <Section id="strengths" tone="tint" title="Where each one is stronger">
          <div className="columns-2">
            <div>
              <h3>Choose {c.competitor} if</h3>
              <Checks kind="yes" items={c.competitorStronger} />
            </div>
            <div>
              <h3>Choose Freero if</h3>
              <Checks kind="yes" items={c.freeroStronger} />
            </div>
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
              {c.competitor} is a trademark of its owner. Freero is not affiliated with or endorsed by {c.competitor}.
            </p>
          </Container>
        </section>
      </>
    ),
  });
}
