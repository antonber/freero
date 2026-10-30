// The contract for a page of the marketing site. A page is a file `src/pages/**/<name>.page.tsx`
// whose default export is `definePage({...})`; the build discovers it (no list to edit) and owns
// everything around the body: <head>, Open Graph image, JSON-LD, breadcrumbs, FAQ, sitemap entry.
// A file whose pages come from data (one per catalog entry, /integrations/<id>) default-exports an
// array of them instead.
import type { ReactElement } from 'react';

export interface FaqItem {
  q: string;
  /** Plain text (it is also the FAQPage JSON-LD answer). */
  a: string;
}

/** Which sitemap a page is listed in (sitemap.xml is the index of these). */
export type SitemapGroup = 'pages' | 'features' | 'use-cases' | 'templates' | 'compare' | 'integrations';

export interface PageDef {
  /** URL path: '/', '/claude', '/vs/example'. No trailing slash. */
  path: string;
  /** <title>: at most 60 characters, unique across the site. */
  title: string;
  /** Meta description: at most 155 characters, unique across the site. */
  description: string;
  /** Short name in breadcrumbs and in the OG image's kicker. */
  name: string;
  /** Headline drawn on the page's Open Graph image (defaults to `name`). */
  ogTitle?: string;
  /**
   * An Open Graph image shared by many pages, drawn once (pages generated from a large catalog,
   * such as one per template, share one per category instead of a PNG each). Pages naming the same
   * `key` get the same image; `kicker` and `title` are drawn on it.
   */
  sharedOg?: { key: string; kicker: string; title: string };
  /** Last meaningful content change (sitemap lastmod), YYYY-MM-DD. */
  updated: string;
  /** false: `noindex`, left out of the sitemap (drafts, the comparison placeholder, 404). */
  index?: boolean;
  /**
   * Legal terms (privacy policy, terms of service): built as a draft — a "Draft: not in effect"
   * banner and `noindex` — that the server puts in effect only once SITE_LEGAL_OPERATOR is set
   * (lib/legal.tsx). Fill the operator's facts with `legal(key)` tokens.
   */
  legal?: boolean;
  sitemap?: SitemapGroup;
  /** Shown after the body, before the closing call to action, and as FAQPage JSON-LD. */
  faq?: FaqItem[];
  /** Extra JSON-LD nodes for this page (Organization, BreadcrumbList and FAQPage are added by the build). */
  jsonLd?: Array<Record<string, unknown>>;
  /** Ends with the shared "start free" band (default true). */
  closingCta?: boolean;
  body: (site: PageContext) => ReactElement;
}

/** What a page body may know about the rest of the site (to list its siblings without a hand-kept list). */
export interface PageContext {
  /** Every page of the build, published or not: filter with `index !== false` before linking. */
  pages: PageDef[];
}

export const definePage = (page: PageDef): PageDef => page;
