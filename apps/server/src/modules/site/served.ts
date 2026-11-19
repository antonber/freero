// The marketing site as this server serves it: the build read once, each page's text with the
// instance's origin and legal facts filled in (cached per origin), and the headers every marketing
// page goes out with. routes.ts serves the built pages through it; other modules that put their
// own data on a page of the site (the community gallery, #162) go through the index's helpers, so
// their pages carry the same head, CSP, analytics and legal state as every other.
//
// For AI agents (agents.ts: model crawlers, AI search, an assistant fetching for a person) and any
// client that asks for it (`Accept: text/markdown`, or a page's address + `.md`), a page goes out
// as Markdown (markdown.ts): the same filled-in page, without the styling and navigation. Search
// engines and people get the HTML, which names the Markdown copy (`rel="alternate"`). Each agent
// visit is counted in PostHog (analytics `trackAgentFetch`), the measure of whether answer engines
// read the site.
import type { Request, Response } from 'express';
import type { Config } from '../../platform/config';
import { log } from '../../platform/log';
import { contentSecurityPolicy } from '../../platform/security';
import { trackAgentFetch, withAnalyticsRuntime, type AgentFetchVia } from '../analytics/index';
import { aiAgentOf } from './agents';
import { legalFill, withLegal } from './legal';
import { pageMarkdown, prefersMarkdown } from './markdown';
import { cspWithAnalytics, loadSite, withAnalytics, withOrigin, type Site } from './site';

export interface ServedSite {
  site: Site | null;
  /** The legal pages are in effect (SITE_LEGAL_OPERATOR set). */
  legalInEffect: boolean;
  /** `raw` (a page or file of the build, by `key`) for the request's origin. */
  textFor(req: Request, key: string, raw: string): string;
  /** Sends `html` (already filled for this request) as a marketing page — as Markdown to an agent or a client that asks for it. */
  sendHtml(req: Request, res: Response, html: string, opts?: SendOpts): void;
  /** Sends a built page by its key (a path, '404'). `markdownUrl`: asked for at its `.md` address. */
  sendPage(req: Request, res: Response, key: string, raw: string, status?: number, opts?: { markdownUrl?: boolean }): void;
}

export interface SendOpts {
  status?: number;
  noindex?: boolean;
  /** The page's path when it isn't the request's (its `.md` address was asked for). */
  path?: string;
  /** Asked for at the page's `.md` address: always Markdown, never indexed (the HTML is the page). */
  markdownUrl?: boolean;
  /** The page's Markdown address, named in the HTML's head and `Link` header. */
  alternate?: string;
  /** `html` is a built page's cached text: its Markdown may be kept too. */
  cacheable?: boolean;
}

/** A built page's Markdown address: `/claude` → `/claude.md`, `/` → `/index.md`. */
export const markdownPathOf = (path: string): string => (path === '/' ? '/index.md' : `${path}.md`);

// One per configuration object (a server has one; tests start several with different settings).
const served = new WeakMap<Config, ServedSite>();

/** The site for this configuration, read from disk once. */
export function servedSite(config: Config): ServedSite {
  const known = served.get(config);
  if (known) return known;
  const site = config.site.enabled ? loadSite(config.site.dist) : null;
  if (config.site.enabled) log(site ? `serving the marketing site from ${config.site.dist}` : `no marketing site build at ${config.site.dist}: / goes to the app`);
  const legal = legalFill(config);
  if (site && site.legal.size) {
    const l = config.site.legal;
    if (!legal.inEffect) log('site: the legal pages are drafts (not in effect, noindex) until SITE_LEGAL_OPERATOR is set');
    else if (!l.contactEmail || !l.address || !l.jurisdiction)
      log('site: SITE_LEGAL_OPERATOR is set but SITE_LEGAL_CONTACT_EMAIL, SITE_LEGAL_ADDRESS or SITE_LEGAL_JURISDICTION is not: the legal pages show placeholders for them');
  }

  // Built once per origin: PUBLIC_URL in production (one entry), the request's own host in development.
  const cache = new Map<string, Map<string, string>>();
  const originOf = (req: Request) => config.publicUrl ?? `${req.protocol}://${req.get('host') ?? 'localhost'}`;
  const textFor = (req: Request, key: string, raw: string): string => {
    const origin = originOf(req);
    let byKey = cache.get(origin);
    if (!byKey) {
      byKey = new Map();
      // Only the configured origin is kept; a development Host header is rendered per request.
      if (origin === config.publicUrl) cache.set(origin, byKey);
    }
    let text = byKey.get(key);
    if (text === undefined) {
      text = withLegal(withOrigin(raw, origin), legal, !!site?.legal.has(key), !!site?.underReview.has(key));
      byKey.set(key, text);
    }
    return text;
  };

  // A built page's Markdown, by its HTML (the cached string of textFor), for the configured origin only.
  const markdownCache = new Map<string, string>();
  const markdownOf = (req: Request, html: string, path: string, cacheable: boolean): string => {
    const keep = cacheable && originOf(req) === config.publicUrl;
    const known = keep ? markdownCache.get(html) : undefined;
    if (known !== undefined) return known;
    const md = pageMarkdown(html, originOf(req) + path);
    if (keep) markdownCache.set(html, md);
    return md;
  };

  const sendHtml: ServedSite['sendHtml'] = (req, res, html, opts = {}) => {
    // The format depends on these headers, so a cache must not hand one client's to another.
    res.vary('Accept');
    res.vary('User-Agent');
    const path = opts.path ?? req.path;
    const agent = aiAgentOf(req.get('user-agent'));
    const via: AgentFetchVia | null = opts.markdownUrl ? 'md-url' : agent ? 'user-agent' : prefersMarkdown(req.get('accept')) ? 'accept' : null;
    if (via) {
      trackAgentFetch(agent ?? 'other', path, via);
      res.setHeader('Cache-Control', 'no-cache');
      if (opts.noindex || opts.markdownUrl) res.setHeader('X-Robots-Tag', 'noindex');
      if (opts.markdownUrl) res.setHeader('Link', `<${originOf(req)}${path}>; rel="canonical"`);
      res
        .status(opts.status ?? 200)
        .type('text/markdown; charset=utf-8')
        .send(markdownOf(req, html, path, !!opts.cacheable));
      return;
    }
    if (opts.alternate) {
      html = html.replace('</head>', `<link rel="alternate" type="text/markdown" href="${opts.alternate}"/></head>`);
      res.setHeader('Link', `<${opts.alternate}>; rel="alternate"; type="text/markdown"`);
    }
    const analytics = config.site.analytics;
    if (analytics) res.setHeader('Content-Security-Policy', cspWithAnalytics(contentSecurityPolicy(config, req.headers.host, req.secure), analytics.src));
    res.setHeader('Cache-Control', 'no-cache');
    if (opts.noindex) res.setHeader('X-Robots-Tag', 'noindex');
    // Google Analytics (GA_MEASUREMENT_ID): Google's script unless this browser opted out, and the opt-out control.
    res.status(opts.status ?? 200).type('html').send(withAnalyticsRuntime(withAnalytics(html, analytics), config));
  };

  const out: ServedSite = {
    site,
    legalInEffect: legal.inEffect,
    textFor,
    sendHtml,
    sendPage(req, res, key, raw, status = 200, { markdownUrl = false } = {}) {
      // A draft of terms, or a page the operator hasn't approved, is never a search result, whatever a
      // cached copy of its markup says.
      const noindex = (!!site?.legal.has(key) && !legal.inEffect) || !!site?.underReview.has(key);
      const isPage = key.startsWith('/');
      sendHtml(req, res, textFor(req, key, raw), {
        status,
        noindex,
        cacheable: true,
        ...(isPage ? { path: key, alternate: markdownPathOf(key) } : {}),
        markdownUrl,
      });
    },
  };
  served.set(config, out);
  return out;
}
