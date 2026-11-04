// The marketing site at `/`, `/claude`, `/chatgpt`, `/vs/*`… (apps/site, built to static files).
// Everything else (the app's /app, /board/*, /login…) falls through to the web app. A signed-in
// visitor at `/` goes to their boards at /app; with SITE=false (or no site build) everyone does.
import express, { Router } from 'express';
import type { ServerContext } from '../../platform/context';
import { handle } from '../../platform/http';
import { userFromCookieHeader } from '../auth/index';
import type { SiteLegal } from '@freero/shared';
import { servedSite } from './served';
import { ROBOTS_NO_SITE } from './site';

// Mounted at the root: it serves `/`, the marketing pages, robots.txt and the sitemaps.
export const mountPath = '/';

export default function siteRoutes({ config }: ServerContext): Router {
  const r = Router();
  const served = servedSite(config);
  const { site, textFor, sendPage } = served;

  // For the app's sign-up page: the terms people agree to, once they are in effect.
  r.get('/api/site/legal', (_req, res) => {
    const ready = !!site && ['/terms', '/privacy', '/acceptable-use'].every((p) => site.legal.has(p) && site.pages.has(p));
    const body: SiteLegal = {
      legal: ready && config.site.legal.operator ? { operator: config.site.legal.operator, termsUrl: '/terms', privacyUrl: '/privacy', acceptableUseUrl: '/acceptable-use' } : null,
    };
    res.setHeader('Cache-Control', 'no-cache');
    res.json(body);
  });

  // IndexNow (scripts/indexnow.mjs submits this host's URLs after a deploy): the search engine
  // fetches /<key>.txt to check the submitter controls the host. Only when SITE_INDEXNOW_KEY is set.
  const indexNowKey = config.site.indexNowKey;
  if (indexNowKey)
    r.get(`/${indexNowKey}.txt`, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.type('text/plain').send(indexNowKey);
    });

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
