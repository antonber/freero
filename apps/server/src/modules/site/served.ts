// The marketing site as this server serves it: the build read once, each page's text with the
// instance's origin and legal facts filled in (cached per origin), and the headers every marketing
// page goes out with. routes.ts serves the built pages through it; other modules that put their
// own data on a page of the site (the community gallery, #162) go through the index's helpers, so
// their pages carry the same head, CSP, analytics and legal state as every other.
import type { Request, Response } from 'express';
import type { Config } from '../../platform/config';
import { log } from '../../platform/log';
import { contentSecurityPolicy } from '../../platform/security';
import { withAnalyticsRuntime } from '../analytics/index';
import { legalFill, withLegal } from './legal';
import { cspWithAnalytics, loadSite, withAnalytics, withOrigin, type Site } from './site';

export interface ServedSite {
  site: Site | null;
  /** The legal pages are in effect (SITE_LEGAL_OPERATOR set). */
  legalInEffect: boolean;
  /** `raw` (a page or file of the build, by `key`) for the request's origin. */
  textFor(req: Request, key: string, raw: string): string;
  /** Sends `html` (already filled for this request) as a marketing page. */
  sendHtml(req: Request, res: Response, html: string, opts?: { status?: number; noindex?: boolean }): void;
  /** Sends a built page by its key (a path, '404'). */
  sendPage(req: Request, res: Response, key: string, raw: string, status?: number): void;
}

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

  const sendHtml: ServedSite['sendHtml'] = (req, res, html, opts = {}) => {
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
    sendPage(req, res, key, raw, status = 200) {
      // A draft of terms, or a page the operator hasn't approved, is never a search result, whatever a
      // cached copy of its markup says.
      const noindex = (!!site?.legal.has(key) && !legal.inEffect) || !!site?.underReview.has(key);
      sendHtml(req, res, textFor(req, key, raw), { status, noindex });
    },
  };
  served.set(config, out);
  return out;
}
