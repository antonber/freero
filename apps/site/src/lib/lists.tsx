// Roundup pages ("the best Miro alternatives", /answers/best-<topic>): the question people put to a
// search engine or an assistant when they want a shortlist, answered as one.
//
// A roundup states no competitor fact of its own. Each pick is a published "Freero vs X" page
// (lib/compare.tsx): its one-line description is that page's summary, its "choose it if" lines are
// picked from that page's reviewed "Choose X if" list, and every fact in the table is a sourced,
// dated row of it (MatrixSection). Freero is listed first and says so, with its own "look
// elsewhere if". A pick that no longer matches its comparison fails the build.
import type { ReactNode } from 'react';
import { Hero, Section } from '../components/ui';
import { answerPages, answerPath, KeepReading, MatrixSection, type Matrix } from './answers';
import type { ComparisonDef } from './compare';
import { definePage, type FaqItem, type PageDef } from './define';
import { softwareApplication } from './seo';
import { abs } from './site';

export interface Pick {
  /** A published comparison (the `comparison` export of a /vs page). */
  product: ComparisonDef;
  /** Who it suits, after "Best for": "facilitated workshops at scale". */
  bestFor: string;
  /** Fragments of the comparison's `competitorStronger` lines: each must match exactly one. */
  chooseIf: string[];
}

export interface FreeroPick {
  bestFor: string;
  /** Why to pick Freero for this job: facts the /facts page and the docs back. */
  chooseIf: ReactNode[];
  /** Where another product is the better choice, said plainly. */
  lookElsewhereIf: ReactNode[];
}

export interface ListDef {
  slug: string;
  /** Breadcrumb and card name. */
  name: string;
  /** The h1: "The best Miro alternatives in 2026". */
  question: string;
  title: string;
  description: string;
  updated: string;
  /** The shortlist in a sentence or two: who should pick what. */
  answer: string;
  /** How the picks were chosen and ordered. */
  criteria: ReactNode[];
  freero: FreeroPick;
  picks: Pick[];
  matrix: Matrix;
  /** Products left out, and why: [name, reason]. */
  notListed?: Array<[string, ReactNode]>;
  related: Array<[string, string]>;
  faq: FaqItem[];
}

/** What a comparison's summary says about the other product: its sentences before the one about Freero. */
function describes(c: ComparisonDef): string {
  const i = c.summary.indexOf(' Freero is');
  const text = (i > 0 ? c.summary.slice(0, i) : '').trim();
  if (!text) throw new Error(`/vs/${c.slug}: its summary doesn't open with a sentence about ${c.competitor}`);
  return text;
}

/** The comparison's "Choose X if" lines that the fragments name, in the order given. */
function chosen(slug: string, p: Pick): string[] {
  return p.chooseIf.map((f) => {
    const hits = p.product.competitorStronger.filter((line) => line.toLowerCase().includes(f.toLowerCase()));
    if (hits.length !== 1) throw new Error(`/answers/${slug}: "${f}" matches ${hits.length} of /vs/${p.product.slug}'s "Choose ${p.product.competitor} if" lines, not 1`);
    return hits[0];
  });
}

export function defineList(l: ListDef): PageDef {
  const path = answerPath(l.slug);
  for (const p of l.picks) if (!p.product.published) throw new Error(`${path}: /vs/${p.product.slug} is not published`);
  const picks = l.picks.map((p) => ({ ...p, lines: chosen(l.slug, p) }));
  const itemList = {
    '@type': 'ItemList',
    name: l.question,
    itemListOrder: 'https://schema.org/ItemListUnordered',
    numberOfItems: picks.length + 1,
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Freero', url: abs('/') },
      ...picks.map((p, i) => ({ '@type': 'ListItem', position: i + 2, name: p.product.competitor, url: abs(`/vs/${p.product.slug}`) })),
    ],
  };
  return definePage({
    path,
    name: l.name,
    title: l.title,
    description: l.description,
    ogTitle: l.question,
    updated: l.updated,
    sitemap: 'answers',
    faq: l.faq,
    jsonLd: [softwareApplication(), itemList],
    body: ({ pages }) => (
      <>
        <Hero kicker="Roundup" title={l.question} lead={l.answer}>
          <p className="works-with">
            We make Freero, so it is listed first. Every other pick comes with when to choose it over Freero, and each fact about it is sourced and dated in the{' '}
            <a href="#compare">table below</a>.
          </p>
        </Hero>

        <Section id="how-we-chose" title="How we chose" narrow>
          <ul>
            {l.criteria.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </Section>

        <Section id="picks" tone="tint" title={`The ${picks.length + 1} picks`}>
          <div className="picks">
            <article className="pick">
              <h3>1. Freero: best for {l.freero.bestFor}</h3>
              <p>
                A free, open-source (MIT) whiteboard for teams of people and AI agents: no paid plans, every feature included, hosted at freero.app or on your own
                servers. Agents such as Claude and ChatGPT propose changes, and people accept them.
              </p>
              <h4>Choose it if</h4>
              <ul>
                {l.freero.chooseIf.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <h4>Look elsewhere if</h4>
              <ul>
                {l.freero.lookElsewhereIf.map((c, i) => (
                  <li key={i}>{c}</li>
                ))}
              </ul>
              <p className="pick__more">
                Every claim, with where to check it: <a href="/facts">Freero key facts</a>.
              </p>
            </article>
            {picks.map((p, i) => (
              <article key={p.product.slug} className="pick">
                <h3>
                  {i + 2}. {p.product.competitor}: best for {p.bestFor}
                </h3>
                <p>{describes(p.product)}</p>
                <h4>Choose it if</h4>
                <ul>
                  {p.lines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
                <p className="pick__more">
                  Full, sourced comparison: <a href={`/vs/${p.product.slug}`}>Freero vs {p.product.competitor}</a>, checked{' '}
                  <time dateTime={p.product.checked}>{p.product.checked}</time>.
                </p>
              </article>
            ))}
          </div>
        </Section>

        <MatrixSection matrix={l.matrix} tone="plain" />

        {l.notListed?.length ? (
          <Section id="not-listed" tone="tint" title="Not on this list" narrow>
            <ul>
              {l.notListed.map(([name, why]) => (
                <li key={name}>
                  <strong>{name}</strong>: {why}
                </li>
              ))}
            </ul>
          </Section>
        ) : null}

        <KeepReading related={l.related} others={answerPages(pages).filter((p) => p.path !== path)} />
      </>
    ),
  });
}
