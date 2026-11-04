// Google Analytics' three endpoints, all inert without GA_MEASUREMENT_ID:
//   GET /api/analytics    whether the app measures (the app's bridge asks once per page load)
//   GET /analytics.js     the runtime (a static file of the web build; 404 while analytics is off)
//   GET /analytics-frame  the hidden same-origin page the app's bridge posts page views and events
//                         to: Google's script runs there, never in a document that holds boards,
//                         titles or names (ARCHITECTURE.md "Analytics")
import { Router } from 'express';
import type { AnalyticsSettings } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { contentSecurityPolicy } from '../../platform/security';
import { analyticsScriptTag, FRAME_PATH, RUNTIME_PATH } from './index';

// /api/analytics and the two root paths: the module serves at the root (like modules/site).
export const mountPath = '/';

export default function analyticsRoutes({ config }: ServerContext): Router {
  const r = Router();
  const on = !!config.googleAnalyticsId;

  r.get('/api/analytics', (_req, res) => {
    const body: AnalyticsSettings = { enabled: on };
    res.setHeader('Cache-Control', 'no-cache');
    res.json(body);
  });

  // Served by the web build's static files (main.ts) only while analytics is on.
  r.get(RUNTIME_PATH, (_req, res, next) => (on ? next() : res.status(404).type('text/plain').send('Not found')));

  r.get(FRAME_PATH, (req, res) => {
    if (!on) return res.status(404).type('text/plain').send('Not found');
    // Only the app itself may frame it; the analytics hosts are in the CSP because the id is set.
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(config, req.headers.host, req.secure, { selfFramed: true }));
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-cache');
    res
      .type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Freero</title>${analyticsScriptTag(config, 'frame')}</head><body></body></html>`);
  });
  return r;
}
