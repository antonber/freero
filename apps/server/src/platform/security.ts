// Security headers and CSRF defence.
//
// CSRF: the session cookie is SameSite=Lax, and every state-changing request (anything but
// GET/HEAD/OPTIONS) whose Origin (or, lacking that, Referer) is another site is refused with 403.
// Requests with neither header come from non-browser clients (curl, server-to-server), which
// cannot ride a victim's cookies, so they pass. WebSocket upgrades get the same Origin check.
import type { IncomingMessage } from 'node:http';
import type { RequestHandler } from 'express';
import { EMBED_FRAME_ORIGINS } from '@freero/shared';
import type { Config } from './config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function firstHeader(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

/** Origins this deployment is served from: PUBLIC_URL plus the Host the request came in on. */
function ownOrigins(req: IncomingMessage, config: Config, secure: boolean): Set<string> {
  const out = new Set<string>();
  if (config.publicUrl) out.add(config.publicUrl);
  const host = (
    config.trustProxy ? (firstHeader(req.headers['x-forwarded-host'])?.split(',')[0].trim() ?? req.headers.host) : req.headers.host
  )?.toLowerCase();
  if (host) {
    out.add(`${secure ? 'https' : 'http'}://${host}`);
    // Behind a TLS-terminating proxy that does not send X-Forwarded-Proto we can't tell; allow both.
    if (!config.trustProxy) out.add(`https://${host}`);
  }
  return out;
}

/** 'same' | 'cross' | 'unknown' (no Origin/Referer: not a browser-initiated cross-site request). */
export function requestOriginKind(req: IncomingMessage, config: Config, secure: boolean): 'same' | 'cross' | 'unknown' {
  const fetchSite = firstHeader(req.headers['sec-fetch-site']);
  if (fetchSite === 'cross-site') return 'cross';
  const origin = firstHeader(req.headers.origin);
  let candidate: string | null = null;
  if (origin !== undefined) {
    if (origin === 'null') return 'cross'; // sandboxed iframes, data: pages, some redirects
    candidate = origin;
  } else {
    const referer = firstHeader(req.headers.referer);
    if (referer) {
      try {
        candidate = new URL(referer).origin;
      } catch {
        return 'cross';
      }
    }
  }
  if (candidate === null) return 'unknown';
  return ownOrigins(req, config, secure).has(candidate.toLowerCase()) ? 'same' : 'cross';
}

const crossSiteEndpoints: Array<{ path: RegExp; reason: string }> = [];

/**
 * Lets browsers POST to `path` from another site. Only for endpoints whose request carries its own
 * proof and never acts on the visitor's cookies — the SAML assertion consumer service, where the
 * identity provider's page posts a signed response (modules/sso) and the sign-in then completes on
 * a same-site GET bound to the browser that started it. Say why in `reason` (it is logged nowhere,
 * but read in review).
 */
export function allowCrossSitePost(path: RegExp, reason: string): void {
  if (reason.trim().length < 10) throw new Error('allowCrossSitePost needs a reason');
  crossSiteEndpoints.push({ path, reason });
}

export function csrfGuard(config: Config): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (req.method === 'POST' && crossSiteEndpoints.some((e) => e.path.test(req.path))) return next();
    if (requestOriginKind(req, config, req.secure) === 'cross') {
      res.status(403).json({ error: 'Cross-site request refused' });
      return;
    }
    next();
  };
}

/** Content-Security-Policy for the app's own pages and API responses. */
export function contentSecurityPolicy(config: Config, host: string | undefined, secure: boolean): string {
  const ws = host ? (secure ? `wss://${host}` : `ws://${host} wss://${host}`) : '';
  const s3 = config.s3?.publicUrl ? new URL(config.s3.publicUrl).origin : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    // React style attributes + Google Fonts stylesheet.
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Board images may link any https image (pasted URLs); exports render through data:/blob:.
    `img-src 'self' data: blob: https: ${s3}`.trim(),
    // Video and audio items play our own uploads (redirected to the bucket when it serves them);
    // blob: is the file being dropped, read locally for its poster frame before it is uploaded.
    `media-src 'self' blob: ${s3}`.trim(),
    // https: lets "paste an image URL" fetch and re-host the image, and exports inline web fonts.
    `connect-src 'self' ${ws} https:`.replace(/\s+/g, ' '),
    "worker-src 'self' blob:",
    // Video players in link cards (features/embed): only these origins, only after a click.
    `frame-src ${EMBED_FRAME_ORIGINS.join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

export function securityHeaders(config: Config): RequestHandler {
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(config, req.headers.host, req.secure));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
