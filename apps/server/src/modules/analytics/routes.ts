// Analytics endpoints, all inert unless the operator configured analytics:
//   GET /api/analytics            what this server measures (the app's bridge asks once per page load)
//   GET /analytics.js             Google's runtime (a static file of the web build; 404 without GA_MEASUREMENT_ID)
//   GET /analytics-frame          the hidden same-origin page the app's bridge posts page views and events
//                                 to: Google's script runs there, never in a document that holds boards,
//                                 titles or names (ARCHITECTURE.md "Analytics")
//   PUT /api/analytics/opt-out    a signed-in person turned analytics off or back on: no product event
//                                 is sent for their account while it is off (404 without POSTHOG_KEY)
//   POST /api/analytics/events    a product event only the app sees (CLIENT_PRODUCT_EVENTS), checked
//                                 against the closed list and sent from here (404 without POSTHOG_KEY)
import { Router } from 'express';
import { parseClientProductEvent, type AnalyticsSettings } from '@freero/shared';
import type { ServerContext } from '../../platform/context';
import { badRequest, handle } from '../../platform/http';
import { rateLimit } from '../../platform/rateLimit';
import { currentRequestContext } from '../../platform/requestContext';
import { contentSecurityPolicy } from '../../platform/security';
import { currentUser, requireUser, userFromCookieHeader } from '../auth/index';
import { analyticsScriptTag, FRAME_PATH, POSTHOG_RUNTIME_PATH, RUNTIME_PATH } from './index';
import { productAnalyticsOn, pseudonym, setAccountOptedOut, trackProductEvent } from './productEvents';
import { anyOptedOut } from './repo';

// /api/analytics and the two root paths: the module serves at the root (like modules/site).
export const mountPath = '/';

export default function analyticsRoutes({ config }: ServerContext): Router {
  const r = Router();
  const on = !!config.googleAnalyticsId;
  const notFound = (res: import('express').Response) => res.status(404).type('text/plain').send('Not found');

  r.get(
    '/api/analytics',
    handle(async (req, res) => {
      const browser = config.posthog?.browser ? config.posthog : null;
      // The signed-in account's pseudonym: the page's PostHog events join the server's under it. An
      // account that turned analytics off gets no PostHog in any browser.
      const user = browser ? await userFromCookieHeader(req.headers.cookie) : null;
      const ph = browser && !(user && (await anyOptedOut([user.id]))) ? browser : null;
      const body: AnalyticsSettings = {
        enabled: on,
        productAnalytics: productAnalyticsOn(),
        ...(ph ? { posthog: { key: ph.key, host: ph.browserHost, uiHost: ph.uiHost, ...(user ? { distinctId: pseudonym('account', user.id) } : {}) } } : {}),
      };
      res.setHeader('Cache-Control', 'private, no-cache');
      res.json(body);
    }),
  );

  // Served by the web build's static files (main.ts) only while analytics is on.
  r.get(RUNTIME_PATH, (_req, res, next) => (on ? next() : notFound(res)));
  r.get(POSTHOG_RUNTIME_PATH, (_req, res, next) => (config.posthog?.browser ? next() : notFound(res)));

  r.get(FRAME_PATH, (req, res) => {
    if (!on) return notFound(res);
    // Only the app itself may frame it; the analytics hosts are in the CSP because the id is set.
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(config, req.headers.host, req.secure, { selfFramed: true }));
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.setHeader('Cache-Control', 'no-cache');
    res
      .type('html')
      .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Freero</title>${analyticsScriptTag(config, 'frame')}</head><body></body></html>`);
  });

  // Before requireUser: a server without PostHog has no such endpoints at all, signed in or not.
  const productOnly: import('express').RequestHandler = (_req, res, next) => (productAnalyticsOn() ? next() : notFound(res));

  r.put(
    '/api/analytics/opt-out',
    productOnly,
    requireUser,
    handle(async (req, res) => {
      const optedOut: unknown = req.body?.optedOut;
      if (typeof optedOut !== 'boolean') throw badRequest('optedOut must be true or false');
      // A browser that still says "don't track" (GPC, Do Not Track, its opt-out cookie) can't turn it back on.
      await setAccountOptedOut(currentUser(req).id, optedOut || currentRequestContext()?.privacySignal === true);
      res.status(204).end();
    }),
  );

  r.post(
    '/api/analytics/events',
    productOnly,
    requireUser,
    rateLimit('productEvents', 'user'),
    handle(async (req, res) => {
      const event = parseClientProductEvent(req.body);
      if (!event) throw badRequest('Not an event the app may report');
      trackProductEvent(currentUser(req).id, event);
      res.status(204).end();
    }),
  );
  return r;
}
