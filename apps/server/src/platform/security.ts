// Security headers and CSRF defence.
//
// CSRF: the session cookie is SameSite=Lax, and every state-changing request (anything but
// GET/HEAD/OPTIONS) whose Origin (or, lacking that, Referer) is another site is refused with 403.
// Requests with neither header come from non-browser clients (curl, server-to-server), which
// cannot ride a victim's cookies, so they pass. WebSocket upgrades get the same Origin check.
import type { IncomingMessage } from 'node:http';
import type { Request, RequestHandler, Response } from 'express';
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

const crossSiteEndpoints: Array<{ path: RegExp; methods: ReadonlySet<string>; reason: string }> = [];

/**
 * Lets browsers POST to `path` from another site. Only for endpoints whose request carries its own
 * proof and never acts on the visitor's cookies — the SAML assertion consumer service, where the
 * identity provider's page posts a signed response (modules/sso) and the sign-in then completes on
 * a same-site GET bound to the browser that started it. Say why in `reason` (it is logged nowhere,
 * but read in review).
 */
export function allowCrossSitePost(path: RegExp, reason: string): void {
  if (reason.trim().length < 10) throw new Error('allowCrossSitePost needs a reason');
  crossSiteEndpoints.push({ path, methods: new Set(['POST']), reason });
}

/**
 * A cross-site API at `path` (any method): endpoints that authenticate ONLY with a credential the
 * caller sends explicitly — an `Authorization: Bearer` token, an OAuth client secret or PKCE
 * verifier — and never read the session cookie, so a request from another site can't ride
 * anyone's session and the Origin check would only refuse legitimate browser-based integrations.
 * Returns their CORS middleware: any origin, never `Access-Control-Allow-Credentials` (browsers
 * then send no cookies at all), preflights answered here. Cookie routes stay checked: a path is
 * exempt only if it matches `path`.
 */
export function allowCrossSiteApi(path: RegExp, reason: string, cors: { methods: string; headers: string; expose?: string }): RequestHandler {
  if (reason.trim().length < 10) throw new Error('allowCrossSiteApi needs a reason');
  crossSiteEndpoints.push({ path, methods: new Set(['POST', 'PUT', 'PATCH', 'DELETE']), reason });
  return (req, res, next) => {
    if (!path.test(req.originalUrl.split('?')[0])) return next();
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (cors.expose) res.setHeader('Access-Control-Expose-Headers', cors.expose);
    // Cross-origin readers fetch with CORS, which this policy would otherwise block for them.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    if (req.method !== 'OPTIONS') return next();
    res.setHeader('Access-Control-Allow-Methods', cors.methods);
    res.setHeader('Access-Control-Allow-Headers', cors.headers);
    res.setHeader('Access-Control-Max-Age', '600');
    res.status(204).end();
  };
}

export function csrfGuard(config: Config): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    if (crossSiteEndpoints.some((e) => e.methods.has(req.method) && e.path.test(req.path))) return next();
    if (requestOriginKind(req, config, req.secure) === 'cross') {
      res.status(403).json({ error: 'Cross-site request refused' });
      return;
    }
    next();
  };
}

const framablePaths: Array<{ path: RegExp; reason: string }> = [];

/**
 * Lets other sites frame the app's pages under `path` — only the AI assistants of
 * `config.appFrameAncestors` (CSP `frame-ancestors`; no X-Frame-Options): the live board view of
 * MCP Apps (modules/embed), which signs in with its own short-lived token, never the session
 * cookie, so a frame can't act on anyone's session. Say why in `reason` (read in review).
 */
export function allowFraming(path: RegExp, reason: string): void {
  if (reason.trim().length < 10) throw new Error('allowFraming needs a reason');
  framablePaths.push({ path, reason });
}
const framable = (path: string) => framablePaths.some((p) => p.path.test(path));

/**
 * Lets ANY site frame this one response: a board embedded live on another site (#2,
 * modules/embed `/embed/b/:id`), decided per board by the handler (its owner allows embedding and
 * its workspace's policy is on). Only for a page that acts on nobody's session cookie — the embed
 * signs in with its own board-bound token from a first-party popup — and starts editing only
 * after a click inside the frame. Every other response keeps frame-ancestors 'none' and
 * X-Frame-Options DENY. Say why in `reason` (read in review).
 */
export function frameFromAnySite(req: Request, res: Response, config: Config, reason: string): void {
  if (reason.trim().length < 10) throw new Error('frameFromAnySite needs a reason');
  setFrameAncestors(req, res, config, ['*']);
}

/**
 * Lets the pages of `ancestors` (CSP `frame-ancestors` sources, https only) frame this one
 * response: the pages of the apps on other platforms (modules/teams, atlassian, meet), framed by
 * that platform itself and no one else, decided per page (a board's page only while the board
 * allows embedding). The same rules as frameFromAnySite apply: no session cookie, editing only
 * after a person acts inside the frame (or, where only the platform can frame it, at once).
 * `scripts`: https origins the page may also load scripts from — only a platform's own SDK that
 * its terms let nobody bundle (Google Meet's add-ons SDK, served by Google).
 */
export function frameFromOrigins(req: Request, res: Response, config: Config, ancestors: readonly string[], reason: string, opts: { scripts?: readonly string[] } = {}): void {
  if (reason.trim().length < 10) throw new Error('frameFromOrigins needs a reason');
  if (!ancestors.length || ancestors.some((a) => !/^https:\/\/(\*\.)?[a-z0-9.-]+$/.test(a))) throw new Error('frameFromOrigins takes https origins (optionally *.host)');
  if (opts.scripts?.some((s) => !/^https:\/\/[a-z0-9.-]+$/.test(s))) throw new Error('frameFromOrigins scripts are https origins');
  setFrameAncestors(req, res, config, [...ancestors], opts.scripts);
}

function setFrameAncestors(req: Request, res: Response, config: Config, ancestors: string[], scripts?: readonly string[]): void {
  res.setHeader('Content-Security-Policy', contentSecurityPolicy(config, req.headers.host, req.secure, { ancestors, scripts }));
  res.removeHeader('X-Frame-Options');
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
}

const openerPaths: Array<{ path: RegExp; reason: string }> = [];

/**
 * Keeps `window.opener` for the app's pages under `path` (Cross-Origin-Opener-Policy unsafe-none
 * instead of same-origin): the popup a board embedded on another site opens to sign in
 * (modules/embed `/embed/connect/`) hands its token back to the frame that opened it, by
 * postMessage to Freero's own origin only. Never framable. Say why in `reason`.
 */
export function allowOpener(path: RegExp, reason: string): void {
  if (reason.trim().length < 10) throw new Error('allowOpener needs a reason');
  openerPaths.push({ path, reason });
}

/** Where Google Analytics' loader comes from (GA_MEASUREMENT_ID). */
export const GA_SCRIPT_ORIGIN = 'https://www.googletagmanager.com';
/** Where it sends what it measures (Google's published CSP sources for GA4). */
export const GA_CONNECT_SOURCES = ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://*.googletagmanager.com'];
/**
 * App pages that never load analytics (the embeds, the pages of the apps on other platforms —
 * Teams, Atlassian, Zoom, Google Meet — and their sign-in pages): their CSP never names Google
 * Analytics.
 */
const NO_ANALYTICS = /^\/(embed|teams|atlassian|zoom|meet)(\/|$)/;

/**
 * Content-Security-Policy for the app's own pages and API responses. `selfFramed`: a page only this
 * origin may frame (the analytics frame, modules/analytics). `analytics: false`: a page that never
 * loads Google Analytics.
 */
export function contentSecurityPolicy(
  config: Config,
  host: string | undefined,
  secure: boolean,
  opts: { framable?: boolean; ancestors?: string[]; selfFramed?: boolean; analytics?: boolean; scripts?: readonly string[] } = {},
): string {
  const ancestors = opts.selfFramed ? ["'self'"] : (opts.ancestors ?? (opts.framable && config.appFrameAncestors.length ? config.appFrameAncestors : ["'none'"]));
  const ws = host ? (secure ? `wss://${host}` : `ws://${host} wss://${host}`) : '';
  const s3 = config.s3?.publicUrl ? new URL(config.s3.publicUrl).origin : '';
  // Google Analytics, only when GA_MEASUREMENT_ID is set: its loader, where it reports, and the
  // app's same-origin analytics frame. Never on a page another site may frame (the assistants'
  // live view, a board embedded anywhere) nor on the embeds' own pages: they load no analytics.
  const ga = !!config.googleAnalyticsId && !opts.framable && !opts.ancestors && opts.analytics !== false;
  // #149: calls docked on the board talk to the operator's own media server — a Jitsi deployment's
  // IFrame API script and meeting frame, or a LiveKit server's signalling socket.
  const calls = callOrigins(config);
  return [
    "default-src 'self'",
    `script-src ${["'self'", ...(ga ? [GA_SCRIPT_ORIGIN] : []), ...calls.scripts, ...(opts.scripts ?? [])].join(' ')}`,
    // React style attributes. Fonts are self-hosted (scripts/fonts.mjs); data: is an export's
    // inlined faces.
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    // Board images may link any https image (pasted URLs); exports render through data:/blob:.
    `img-src 'self' data: blob: https: ${s3}`.trim(),
    // Video and audio items play our own uploads (redirected to the bucket when it serves them);
    // blob: is the file being dropped, read locally for its poster frame before it is uploaded.
    `media-src 'self' blob: ${s3}`.trim(),
    // https: lets "paste an image URL" fetch and re-host the image, and exports inline web fonts.
    `connect-src 'self' ${ws} https:${ga ? ` ${GA_CONNECT_SOURCES.join(' ')}` : ''} ${calls.connect.join(' ')}`.replace(/\s+/g, ' ').trim(),
    "worker-src 'self' blob:",
    // Live embeds in link cards (features/embed): the built-in providers' players and viewers plus
    // the operator's EMBED_EXTRA_ORIGINS — only these origins, only after a click.
    `frame-src ${[...(ga ? ["'self'"] : []), ...EMBED_FRAME_ORIGINS, ...config.embedExtraOrigins, ...calls.frames].join(' ')}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${ancestors.join(' ')}`,
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** #149: what the operator's media server for docked calls needs in the CSP (nothing without one). */
function callOrigins(config: Config): { scripts: string[]; frames: string[]; connect: string[] } {
  const c = config.boardCalls;
  if (!c) return { scripts: [], frames: [], connect: [] };
  if (c.provider === 'jitsi') return { scripts: [`https://${c.domain}`], frames: [`https://${c.domain}`], connect: [`wss://${c.domain}`] };
  const u = new URL(c.url);
  const host = u.host;
  const plain = u.protocol === 'ws:' || u.protocol === 'http:';
  return { scripts: [], frames: [], connect: plain ? [`ws://${host}`, `http://${host}`] : [`wss://${host}`] };
}

/**
 * Camera, microphone and screen sharing stay off for every page — except where the operator runs a
 * media server for calls on the board (#149): then this origin may ask for them, and a Jitsi
 * deployment's meeting frame too.
 */
export function permissionsPolicy(config: Config): string {
  const c = config.boardCalls;
  if (!c) return 'camera=(), microphone=(), geolocation=(), payment=(), usb=()';
  const allow = c.provider === 'jitsi' ? `(self "https://${c.domain}")` : '(self)';
  return `camera=${allow}, microphone=${allow}, display-capture=${allow}, geolocation=(), payment=(), usb=()`;
}

export function securityHeaders(config: Config): RequestHandler {
  return (req, res, next) => {
    const frame = req.method === 'GET' && framable(req.path);
    res.setHeader('Content-Security-Policy', contentSecurityPolicy(config, req.headers.host, req.secure, { framable: frame, analytics: !NO_ANALYTICS.test(req.path) }));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!frame) res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', req.method === 'GET' && openerPaths.some((p) => p.path.test(req.path)) ? 'unsafe-none' : 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', frame ? 'cross-origin' : 'same-origin');
    res.setHeader('Permissions-Policy', permissionsPolicy(config));
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}
