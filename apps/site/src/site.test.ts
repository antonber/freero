// The built site, checked the way search engines and visitors meet it: one real build into a temp
// directory, served under a real origin (the substitution modules/site does).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSite, SITE_PREFIXES } from './build';
import { defineComparison, type ComparisonDef } from './lib/compare';
import type { PageDef } from './lib/define';
import { DISALLOWED } from './lib/seo';
import { APP, ORIGIN } from './lib/site';

const HOST = 'https://whiteboard.example.com';
let dist = '';
let pages: PageDef[] = [];
const html = new Map<string, string>();
let manifest: { pages: Array<{ path: string; file: string }>; files: Array<{ path: string; file: string }> };
const served = (file: string) => fs.readFileSync(path.join(dist, file), 'utf8').split(ORIGIN).join(HOST);

beforeAll(async () => {
  dist = fs.mkdtempSync(path.join(os.tmpdir(), 'freero-site-'));
  pages = (await buildSite(dist)).pages;
  manifest = JSON.parse(fs.readFileSync(path.join(dist, 'manifest.json'), 'utf8'));
  for (const p of manifest.pages) html.set(p.path, served(p.file));
}, 60_000);

const indexable = () => pages.filter((p) => p.index !== false);
const attr = (doc: string, re: RegExp) => [...doc.matchAll(re)].map((m) => m[1].replace(/&amp;/g, '&'));
const jsonLd = (doc: string) => attr(doc, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g).map((s) => JSON.parse(s) as { '@graph': Array<Record<string, unknown>> });
const text = (doc: string) => doc.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, '’').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('every page as a search result', () => {
  it('a duplicate or over-long title or description, or a missing or second h1, never ships', () => {
    const titles = new Set<string>();
    const descriptions = new Set<string>();
    for (const p of pages) {
      expect(p.title.length, p.path).toBeLessThanOrEqual(60);
      expect(p.description.length, p.path).toBeLessThanOrEqual(155);
      expect(titles.has(p.title), `duplicate title ${p.title}`).toBe(false);
      expect(descriptions.has(p.description), `duplicate description on ${p.path}`).toBe(false);
      titles.add(p.title);
      descriptions.add(p.description);
      const doc = p.path === '/404' ? served('404.html') : html.get(p.path)!;
      expect(doc.match(/<h1[ >]/g)?.length, `${p.path} h1 count`).toBe(1);
    }
  });

  it('canonical, Open Graph and Twitter URLs point at this deployment’s own page and image, never the build placeholder', () => {
    for (const [p, doc] of html) {
      expect(doc.includes('origin.freero.invalid'), p).toBe(false);
      expect(attr(doc, /<link rel="canonical" href="([^"]+)"/g), p).toEqual([`${HOST}${p === '/' ? '/' : p}`]);
      expect(attr(doc, /<meta property="og:url" content="([^"]+)"/g), p).toEqual([`${HOST}${p === '/' ? '/' : p}`]);
      const [og] = attr(doc, /<meta property="og:image" content="([^"]+)"/g);
      expect(og?.startsWith(`${HOST}/_site/og/`), p).toBe(true);
      expect(fs.existsSync(path.join(dist, og.slice(HOST.length))), `${p}: ${og} missing`).toBe(true);
      expect(attr(doc, /<meta name="twitter:image" content="([^"]+)"/g), p).toEqual([og]);
    }
  });

  it('structured data parses, has breadcrumbs on every inner page, and its FAQ answers are the ones on the page', () => {
    for (const p of pages.filter((p) => p.path !== '/404')) {
      const doc = html.get(p.path)!;
      const graph = jsonLd(doc).flatMap((d) => d['@graph']);
      const types = graph.map((n) => n['@type']);
      expect(types, p.path).toEqual(expect.arrayContaining(['Organization', 'WebSite', 'WebPage']));
      if (p.path !== '/') {
        const crumbs = graph.find((n) => n['@type'] === 'BreadcrumbList') as { itemListElement: Array<{ item: string }> } | undefined;
        expect(crumbs?.itemListElement.at(-1)?.item, p.path).toBe(`${HOST}${p.path}`);
      }
      const faq = graph.find((n) => n['@type'] === 'FAQPage') as { mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }> } | undefined;
      expect(!!faq, `${p.path} FAQPage`).toBe(!!p.faq?.length);
      const visible = text(doc);
      for (const q of faq?.mainEntity ?? []) {
        expect(visible.includes(q.name), `${p.path}: question not on the page: ${q.name}`).toBe(true);
        expect(visible.includes(q.acceptedAnswer.text), `${p.path}: answer not on the page: ${q.name}`).toBe(true);
      }
    }
  });

  it('the home page and pricing describe Freero as free software for the web', () => {
    for (const p of ['/', '/pricing']) {
      const app = jsonLd(html.get(p)!)
        .flatMap((d) => d['@graph'])
        .find((n) => n['@type'] === 'SoftwareApplication') as { operatingSystem: string; offers: { price: string } } | undefined;
      expect(app?.operatingSystem, p).toBe('Web');
      expect(app?.offers.price, p).toBe('0');
    }
  });
});

describe('crawling', () => {
  const sitemapUrls = () =>
    manifest.files
      .filter((f) => /^\/sitemap-.+\.xml$/.test(f.path))
      .flatMap((f) => attr(served(f.file), /<loc>([^<]+)<\/loc>/g));

  it('the sitemaps list exactly the indexable pages, and the index lists every sitemap', () => {
    expect(sitemapUrls().sort()).toEqual(indexable().map((p) => `${HOST}${p.path === '/' ? '/' : p.path}`).sort());
    const index = attr(served('sitemap.xml'), /<loc>([^<]+)<\/loc>/g);
    expect(index.sort()).toEqual(manifest.files.filter((f) => /^\/sitemap-.+\.xml$/.test(f.path)).map((f) => `${HOST}${f.path}`).sort());
  });

  it('noindex pages (404, unpublished comparisons) say so and are linked from no indexable page', () => {
    const hidden = pages.filter((p) => p.index === false && p.path !== '/404');
    expect(hidden.length).toBeGreaterThan(0);
    for (const p of hidden) expect(html.get(p.path)!.includes('<meta name="robots" content="noindex, follow"/>'), p.path).toBe(true);
    for (const p of indexable()) {
      const hrefs = attr(html.get(p.path)!, /href="([^"]+)"/g);
      for (const h of hidden) expect(hrefs.some((x) => x === h.path || x === `${HOST}${h.path}`), `${p.path} links to ${h.path}`).toBe(false);
    }
  });

  /** Google's robots.txt matching: longest matching rule wins, Allow wins a tie; `$` anchors the end. */
  const blocked = (robots: string, p: string) => {
    const rules = [...robots.matchAll(/^(Allow|Disallow):\s*(\S+)$/gm)].map((m) => ({ allow: m[1] === 'Allow', pat: m[2] }));
    const matches = (pat: string) => new RegExp(`^${pat.replace(/[.*+?^${}()|[\]\\]/g, (c) => (c === '*' ? '.*' : c === '$' ? c : `\\${c}`)).replace(/\\\$$/, '$')}`).test(p);
    const hit = rules.filter((r) => matches(r.pat)).sort((a, b) => b.pat.length - a.pat.length || Number(b.allow) - Number(a.allow))[0];
    return !!hit && !hit.allow;
  };

  it('robots.txt keeps crawlers out of the app, boards, invites and the API but never blocks a marketing page', () => {
    const robots = served('robots.txt');
    for (const p of indexable()) expect(blocked(robots, p.path), `${p.path} is blocked`).toBe(false);
    for (const app of ['/app', '/board/abc', '/doc/abc', '/embed/board/abc', '/api/v1/me', '/mcp', '/login', '/signup', '/invite/tok', '/oauth/authorize', '/settings'])
      expect(blocked(robots, app), `${app} is crawlable`).toBe(true);
    expect(robots).toContain(`Sitemap: ${HOST}/sitemap.xml`);
  });

  it('a marketing page never takes over a route of the web app', () => {
    const appTsx = fs.readFileSync(path.resolve(__dirname, '../../web/src/app/App.tsx'), 'utf8');
    const appRoutes = attr(appTsx, /path="([^"]+)"/g).filter((r) => r !== '/' && r !== '*');
    expect(appRoutes.length).toBeGreaterThan(10);
    const firstSegment = (r: string) => `/${r.split('/')[1]}`;
    for (const p of pages) {
      if (p.path === '/') continue;
      for (const r of appRoutes) expect(firstSegment(p.path) === firstSegment(r), `${p.path} collides with the app's ${r}`).toBe(false);
    }
    for (const prefix of SITE_PREFIXES) for (const r of appRoutes) expect(`${r}/`.startsWith(prefix), `${prefix} covers ${r}`).toBe(false);
  });
});

describe('pages work without JavaScript', () => {
  it('no page runs a script or loads anything from another origin', () => {
    for (const [p, doc] of html) {
      expect(/<script(?![^>]*type="application\/ld\+json")/.test(doc), `${p} ships a script`).toBe(false);
      for (const src of attr(doc, /(?:src|srcSet|srcset)="([^"]+)"/g).flatMap((s) => s.split(',').map((x) => x.trim().split(' ')[0])))
        expect(src.startsWith('/'), `${p} loads ${src}`).toBe(true);
      for (const l of attr(doc, /<link[^>]+href="([^"]+)"/g)) expect(l.startsWith('/') || l.startsWith(HOST), `${p} links a resource at ${l}`).toBe(true);
      expect(/@import|url\(https?:/.test(doc), `${p} pulls CSS from elsewhere`).toBe(false);
    }
  });

  it('every image has alt text and its size, so the layout doesn’t jump', () => {
    for (const [p, doc] of html)
      for (const img of doc.match(/<img [^>]+>/g) ?? []) {
        expect(/ alt="[^"]+"/.test(img), `${p}: ${img.slice(0, 80)}`).toBe(true);
        expect(/ width="\d+"/.test(img) && / height="\d+"/.test(img), `${p}: no size on ${img.slice(0, 80)}`).toBe(true);
      }
  });

  it('no internal link is broken: each goes to a page, an anchor on it, a built file or an app route', () => {
    const appPaths = new Set<string>([...Object.values(APP), '/api/v1/openapi.json']);
    for (const [p, doc] of html) {
      for (const href of attr(doc, /<a [^>]*href="([^"]+)"/g)) {
        if (/^(https?:|mailto:)/.test(href) && !href.startsWith(HOST)) continue;
        const local = href.startsWith(HOST) ? href.slice(HOST.length) || '/' : href;
        const [route, hash] = local.split('#');
        const target = route === '' ? p : route;
        if (appPaths.has(target)) continue;
        const page = html.get(target);
        if (!page) {
          expect(fs.existsSync(path.join(dist, target)), `${p} links to missing ${href}`).toBe(true);
          continue;
        }
        if (hash) expect(page.includes(`id="${hash}"`), `${p} links to missing anchor ${href}`).toBe(true);
      }
    }
  });
});

describe('comparison pages', () => {
  const base: ComparisonDef = {
    slug: 'someone',
    competitor: 'Someone',
    checked: '2026-10-28',
    published: true,
    title: 't',
    description: 'd',
    summary: 's',
    competitorStronger: [],
    freeroStronger: [],
    sources: [{ id: 'S1', title: 'Pricing page', url: 'https://example.com/pricing', checked: '2026-10-28' }],
    rows: [{ capability: 'SSO', competitor: { verdict: 'paid', sources: ['S1'] }, freero: { verdict: 'yes', ref: 'docs/configuration.md' } }],
  };

  it('a comparison can’t be published with a claim about the competitor that is unverified or has no source', () => {
    expect(() => defineComparison(base)).not.toThrow();
    expect(() => defineComparison({ ...base, rows: [{ ...base.rows[0], competitor: { verdict: 'unverified', sources: [] } }] })).toThrow(/not verified/);
    expect(() => defineComparison({ ...base, rows: [{ ...base.rows[0], competitor: { verdict: 'no', sources: [] } }] })).toThrow(/no source/);
    expect(() => defineComparison({ ...base, rows: [{ ...base.rows[0], competitor: { verdict: 'no', sources: ['S9'] } }] })).toThrow(/unknown source/);
  });
});
