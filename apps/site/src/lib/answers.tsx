// Answer pages (/answers/<slug>): one question people put to a search engine or an AI assistant
// ("is there a free whiteboard with SSO?"), answered in the first sentences, then the checkable facts,
// a dated comparison where one helps, how-to steps, links into the rest of the site and an FAQ.
//
// A comparison here never states a competitor fact of its own: each cell is a row of a published
// "Freero vs X" page (lib/compare.tsx), with that row's sources and their check dates. A row that is
// renamed or a comparison that is unpublished fails the build instead of leaving a stale claim.
import type { ReactNode } from 'react';
import { Card, Cards, Checks, Hero, Section, Step, Steps, Table } from '../components/ui';
import { cell, freeroCell, VERDICT_TEXT, type ComparisonDef, type FreeroCell, type Source } from './compare';
import { definePage, type FaqItem, type PageDef } from './define';
import { softwareApplication } from './seo';
import { SOURCE_REPO } from './site';

export const ANSWERS_PATH = '/answers';
export const answerPath = (slug: string) => `${ANSWERS_PATH}/${slug}`;

/** The answer pages of a build, in the order their files sort (the hub, llms.txt and each page's "more answers"). */
export const answerPages = (pages: PageDef[]) => pages.filter((p) => p.path.startsWith(`${ANSWERS_PATH}/`) && p.index !== false);

export interface MatrixRow {
  /** A published comparison (the `comparison` export of a /vs page). */
  product: ComparisonDef;
  /** Per column, the capability of one of that comparison's rows, or null where it compares nothing like it. */
  cells: Array<string | null>;
}

/** Products down the side, capabilities across: one table from several comparisons. */
export interface Matrix {
  title: string;
  lead?: string;
  /** The table's caption; the competitor check dates are added to it. */
  caption: string;
  columns: string[];
  rows: MatrixRow[];
  /** Freero's own cells, one per column. */
  freero: FreeroCell[];
}

export interface AnswerDef {
  slug: string;
  /** Breadcrumb and card name. */
  name: string;
  /** The h1: the question, as people ask it. */
  question: string;
  title: string;
  /** Meta description: the direct answer in brief (also its line in /llms.txt and on the hub). */
  description: string;
  updated: string;
  /** The direct answer: what, free, open source, the differentiator. One or two sentences. */
  answer: string;
  /** Short statements, each one a reader could check. */
  facts: ReactNode[];
  matrix?: Matrix;
  steps?: { title: string; lead?: string; items: Array<{ title: string; body: ReactNode }> };
  /** Further sections, between the comparison and the steps. */
  sections?: () => ReactNode;
  /** Where to go next on the site: [href, label]. */
  related: Array<[string, string]>;
  faq: FaqItem[];
}

interface CitedSource extends Source {
  key: string;
  via: ComparisonDef;
}

/**
 * A matrix as a section: the table, then its sources with their check dates and the comparison
 * each comes from. Used by answer pages and by any page that answers a "which ones can…" question.
 */
export function MatrixSection({ matrix: m, id = 'compare', tone = 'tint' }: { matrix: Matrix; id?: string; tone?: 'plain' | 'tint' }) {
  // Number the sources in the order the table cites them.
  const cited: CitedSource[] = [];
  const no = new Map<string, number>();
  const cite = (c: ComparisonDef, ids: string[]) =>
    ids.map((sid) => {
      const key = `${c.slug}-${sid}`;
      if (!no.has(key)) {
        const s = c.sources.find((x) => x.id === sid);
        if (!s) throw new Error(`/vs/${c.slug} cites unknown source ${sid}`);
        cited.push({ ...s, key, via: c });
        no.set(key, cited.length);
      }
      return (
        <a key={key} className="cite" href={`#source-${key}`} aria-label={`Source ${no.get(key)}`}>
          [{no.get(key)}]
        </a>
      );
    });
  if (m.freero.length !== m.columns.length) throw new Error(`matrix "${m.title}": Freero needs ${m.columns.length} cells`);
  const rows: ReactNode[][] = m.rows.map(({ product: c, cells }) => {
    if (!c.published) throw new Error(`matrix "${m.title}": /vs/${c.slug} is not published`);
    if (cells.length !== m.columns.length) throw new Error(`matrix "${m.title}": ${c.competitor} needs ${m.columns.length} cells`);
    return [
      <>
        <a href={`/vs/${c.slug}`}>{c.column ?? c.competitor}</a>
        <span className="matrix__checked">
          checked <time dateTime={c.checked}>{c.checked}</time>
        </span>
      </>,
      ...cells.map((capability) => {
        if (capability === null) return <span className="matrix__none">Not compared</span>;
        const row = c.rows.find((r) => r.capability === capability);
        if (!row) throw new Error(`matrix "${m.title}": /vs/${c.slug} has no row "${capability}"`);
        return cell(VERDICT_TEXT[row.competitor.verdict], row.competitor.note, cite(c, row.competitor.sources));
      }),
    ];
  });
  rows.push([<strong key="f">Freero</strong>, ...m.freero.map((f) => freeroCell(f))]);
  const dates = [...new Set(m.rows.map((r) => r.product.checked))].sort();
  const asOf = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates.at(-1)}`;
  return (
    <Section id={id} tone={tone} title={m.title} lead={m.lead}>
      <Table stack caption={`${m.caption}, as of ${asOf}`} head={['Product', ...m.columns]} rows={rows} />
      <p className="footer__note">
        Other products’ facts as of {asOf}, from their own public pages (numbered below); each name links to the full, sourced comparison. Plans and prices
        change: check the vendor’s page before you decide. Facts about Freero link to its documentation.
      </p>
      <h3 id={`${id}-sources`}>Sources and dates</h3>
      <ol className="sources">
        {cited.map((s) => (
          <li key={s.key} id={`source-${s.key}`}>
            <a href={s.url} rel="nofollow noopener">
              {s.title}
            </a>
            , checked <time dateTime={s.checked}>{s.checked}</time> (in <a href={`/vs/${s.via.slug}`}>Freero vs {s.via.competitor}</a>)
          </li>
        ))}
      </ol>
      <p className="footer__note">
        Spotted a mistake? <a href={`${SOURCE_REPO}/issues`}>Tell us</a> and we will correct it. Product names here are trademarks of their respective owners,
        used only to identify their products; Freero is not affiliated with or endorsed by any of them.
      </p>
    </Section>
  );
}

export function defineAnswer(a: AnswerDef): PageDef {
  const path = answerPath(a.slug);
  return definePage({
    path,
    name: a.name,
    title: a.title,
    description: a.description,
    ogTitle: a.question,
    updated: a.updated,
    sitemap: 'answers',
    faq: a.faq,
    jsonLd: [softwareApplication()],
    body: ({ pages }) => {
      const others = answerPages(pages).filter((p) => p.path !== path);
      return (
        <>
          <Hero kicker="Answer" title={a.question} lead={a.answer} />

          <Section id="facts" title="The facts" narrow>
            <Checks kind="yes" items={a.facts} />
            <p>
              More, each with where to check it: <a href="/facts">Freero key facts</a>.
            </p>
          </Section>

          {a.matrix ? <MatrixSection matrix={a.matrix} /> : null}

          {a.sections?.()}

          {a.steps ? (
            <Section id="how" title={a.steps.title} lead={a.steps.lead} tone={a.matrix ? 'plain' : 'tint'}>
              <Steps>
                {a.steps.items.map((s) => (
                  <Step key={s.title} title={s.title}>
                    {s.body}
                  </Step>
                ))}
              </Steps>
            </Section>
          ) : null}

          <Section id="more" tone="tint" title="Keep reading">
            <div className="columns-2">
              <div>
                <h3>On this site</h3>
                <ul>
                  {a.related.map(([href, label]) => (
                    <li key={href}>
                      <a href={href}>{label}</a>
                    </li>
                  ))}
                </ul>
              </div>
              {others.length ? (
                <div>
                  <h3>Other questions</h3>
                  <ul>
                    {others.map((p) => (
                      <li key={p.path}>
                        <a href={p.path}>{p.ogTitle ?? p.name}</a>
                      </li>
                    ))}
                    <li>
                      <a href={ANSWERS_PATH}>All answers</a>
                    </li>
                  </ul>
                </div>
              ) : null}
            </div>
          </Section>
        </>
      );
    },
  });
}

/** The hub's cards: every answer page, its question and its short answer. */
export function AnswerCards({ pages }: { pages: PageDef[] }) {
  return (
    <Cards cols={2}>
      {answerPages(pages).map((p) => (
        <Card key={p.path} title={p.ogTitle ?? p.name} href={p.path}>
          <p>{p.description}</p>
        </Card>
      ))}
    </Cards>
  );
}
