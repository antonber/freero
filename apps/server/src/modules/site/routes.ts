// The marketing site at `/`, `/claude`, `/chatgpt`, `/vs/*`… (apps/site, built to static files).
// Everything else (the app's /app, /board/*, /login…) falls through to the web app. A signed-in
// visitor at `/` goes to their boards at /app; with SITE=false (or no site build) everyone does.
import express, { Router, type Request, type Response } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { log } from '../../platform/log';
import { contentSecurityPolicy } from '../../platform/security';
import { userFromCookieHeader } from '../auth/index';
import { cspWithAnalytics, loadSite, ROBOTS_NO_SITE, withAnalytics, withOrigin } from './site';

// Mounted at the root: it serves `/`, the marketing pages, robots.txt and the sitemaps.
export const mountPath = '/';

export default function siteRoutes({ config }: ServerContext): Router {
  const r = Router();
  const site = config.site.enabled ? loadSite(config.site.dist) : null;
  if (config.site.enabled) log(site ? `serving the marketing site from ${config.site.dist}` : `no marketing site build at ${config.site.dist}: / goes to the app`);

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
      text = withOrigin(raw, origin);
      byKey.set(key, text);
    }
    return text;
  };

  const sendPage = (req: Request, res: Response, key: string, raw: string, status = 200) => {
    const analytics = config.site.analytics;
    if (analytics) res.setHeader('Content-Security-Policy', cspWithAnalytics(contentSecurityPolicy(config, req.headers.host, req.secure), analytics.src));
    res.setHeader('Cache-Control', 'no-cache');
    res.status(status).type('html').send(withAnalytics(textFor(req, key, raw), analytics));
  };

  r.get('/robots.txt', (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    const robots = site?.files.get('/robots.txt');
    res.type('text/plain').send(robots ? textFor(req, '/robots.txt', robots.text) : ROBOTS_NO_SITE);
  });

  r.get(
    '/',
    handle(async (req, res) => {
      // A signed-in person's home is their boards; the page differs by cookie, so caches must not share it.
      res.setHeader('Vary', 'Cookie');
      if (!site || (await userFromCookieHeader(req.headers.cookie))) {
        res.setHeader('Cache-Control', 'no-store');
        return res.redirect(302, '/app');
      }
      sendPage(req, res, '/', site.pages.get('/')!);
    }),
  );
  if (!site) return r;

  r.use(site.assetsPrefix, express.static(site.assetsDir, { index: false, immutable: true, maxAge: '1y', fallthrough: false }));

  r.get(/.*/, (req, res, next) => {
    const p = req.path;
    const file = site.files.get(p);
    if (file) {
      res.setHeader('Cache-Control', 'no-cache');
      return res.type(file.type).send(textFor(req, p, file.text));
    }
    // One URL per page: /claude/ → /claude (the canonical form).
    if (p.length > 1 && p.endsWith('/') && site.pages.has(p.replace(/\/+$/, ''))) {
      const q = req.originalUrl.indexOf('?');
      return res.redirect(301, p.replace(/\/+$/, '') + (q >= 0 ? req.originalUrl.slice(q) : ''));
    }
    const page = site.pages.get(p);
    if (page !== undefined) return sendPage(req, res, p, page);
    if (site.prefixes.some((prefix) => p.startsWith(prefix))) return sendPage(req, res, '404', site.notFound, 404);
    next();
  });
  return r;
}
