// Structured data (schema.org JSON-LD), sitemaps and robots.txt, from the page definitions.
import type { Crumb } from '../components/Document';
import type { PageDef, SitemapGroup } from './define';
import { abs, ORIGIN, SOURCE_REPO } from './site';

const ORG_ID = `${ORIGIN}/#organization`;
const SITE_ID = `${ORIGIN}/#website`;
const APP_ID = `${ORIGIN}/#software`;

/** The breadcrumb trail of a page: Home, then each parent path that is a page, then the page. */
export function crumbsOf(page: PageDef, byPath: Map<string, PageDef>): Crumb[] {
  const out: Crumb[] = [{ name: 'Home', path: '/' }];
  if (page.path === '/') return out;
  const parts = page.path.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const p = `/${parts.slice(0, i).join('/')}`;
    const parent = byPath.get(p);
    if (parent) out.push({ name: parent.name, path: p });
  }
  out.push({ name: page.name, path: page.path });
  return out;
}

export function softwareApplication(): Record<string, unknown> {
  return {
    '@type': 'SoftwareApplication',
    '@id': APP_ID,
    name: 'Freero',
    url: abs('/'),
    description:
      'An online whiteboard for teams of people and AI agents: brainstorm, plan and diagram together; agents connect over MCP, read boards and propose changes people approve.',
    applicationCategory: 'BusinessApplication',
    applicationSubCategory: 'Online whiteboard',
    operatingSystem: 'Web',
    browserRequirements: 'A current version of Chrome, Edge, Firefox or Safari',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    license: 'https://opensource.org/license/mit',
    publisher: { '@id': ORG_ID },
  };
}

export function jsonLdFor(page: PageDef, crumbs: Crumb[], ogImage: string): Record<string, unknown> {
  const url = abs(page.path);
  const graph: Array<Record<string, unknown>> = [
    {
      '@type': 'Organization',
      '@id': ORG_ID,
      name: 'Freero',
      url: abs('/'),
      logo: { '@type': 'ImageObject', url: abs(LOGO_PNG_PATH.value), width: 512, height: 512 },
      sameAs: [SOURCE_REPO],
    },
    { '@type': 'WebSite', '@id': SITE_ID, url: abs('/'), name: 'Freero', inLanguage: 'en', publisher: { '@id': ORG_ID } },
    {
      '@type': 'WebPage',
      '@id': `${url}#webpage`,
      url,
      name: page.title,
      description: page.description,
      inLanguage: 'en',
      isPartOf: { '@id': SITE_ID },
      dateModified: page.updated,
      primaryImageOfPage: { '@type': 'ImageObject', url: abs(ogImage), width: 1200, height: 630 },
      ...(crumbs.length > 1 ? { breadcrumb: { '@id': `${url}#breadcrumb` } } : {}),
    },
  ];
  if (crumbs.length > 1)
    graph.push({
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: abs(c.path) })),
    });
  if (page.faq?.length)
    graph.push({
      '@type': 'FAQPage',
      '@id': `${url}#faq`,
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    });
  graph.push(...(page.jsonLd ?? []));
  return { '@context': 'https://schema.org', '@graph': graph };
}

/** Set by the build once the logo PNG is emitted (its name carries a content hash). */
export const LOGO_PNG_PATH = { value: '' };

const xmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** sitemap.xml (an index of one sitemap per group that has pages) and each group's sitemap. */
export function sitemaps(pages: PageDef[]): Array<{ path: string; xml: string }> {
  const groups = new Map<SitemapGroup, PageDef[]>();
  for (const p of pages.filter((p) => p.index !== false)) {
    const g = p.sitemap ?? 'pages';
    groups.set(g, [...(groups.get(g) ?? []), p]);
  }
  const out: Array<{ path: string; xml: string }> = [];
  for (const [g, list] of groups) {
    const urls = list
      .sort((a, b) => a.path.localeCompare(b.path))
      .map((p) => `  <url><loc>${xmlEscape(abs(p.path))}</loc><lastmod>${p.updated}</lastmod></url>`)
      .join('\n');
    out.push({ path: `/sitemap-${g}.xml`, xml: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n` });
  }
  const newest = (list: PageDef[]) => list.map((p) => p.updated).sort().at(-1)!;
  const index = [...groups]
    .map(([g, list]) => `  <sitemap><loc>${xmlEscape(abs(`/sitemap-${g}.xml`))}</loc><lastmod>${newest(list)}</lastmod></sitemap>`)
    .join('\n');
  out.unshift({ path: '/sitemap.xml', xml: `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${index}\n</sitemapindex>\n` });
  return out;
}

/**
 * App paths crawlers never need: the app itself, boards (share and guest links), the API and MCP
 * server, sign-in and account pages, invite and email links. The app also answers them with
 * `X-Robots-Tag: noindex` and a robots meta tag.
 */
export const DISALLOWED = [
  '/app$',
  '/app/',
  '/board/',
  '/api/',
  '/mcp',
  '/oauth/',
  '/ws/',
  '/uploads/',
  '/login',
  '/signup',
  '/forgot-password',
  '/reset-password',
  '/revert-email',
  '/undo-two-factor',
  '/recover-two-factor',
  '/cancel-recovery',
  '/verify-email',
  '/confirm-email',
  '/invite/',
  '/workspace-invite/',
  '/unsubscribe',
  '/appeal',
  '/settings',
  '/admin/',
  '/operator',
];

export function robotsTxt(): string {
  return `# Freero: the marketing pages are for search engines; the app is not.
User-agent: *
${DISALLOWED.map((d) => `Disallow: ${d}`).join('\n')}
Allow: /

Sitemap: ${abs('/sitemap.xml')}
`;
}
