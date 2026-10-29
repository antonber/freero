// The marketing site (apps/site), as built: static pages, sitemaps, robots.txt and hashed assets,
// described by the build's manifest.json. Pages are built with a placeholder origin; this module
// puts the instance's own origin (PUBLIC_URL) into canonical links, Open Graph tags, JSON-LD and
// sitemaps when it serves them, so one build (one Docker image) serves any deployment.
import fs from 'node:fs';
import path from 'node:path';

/** The origin pages are built with (apps/site `ORIGIN_PLACEHOLDER`); replaced by the real one when served. */
export const ORIGIN_PLACEHOLDER = 'https://origin.freero.invalid';

/** apps/site's build manifest (src/build.ts). */
interface Manifest {
  version: 1;
  pages: Array<{ path: string; file: string }>;
  /** Files served as they are (robots.txt, sitemaps), by URL path. */
  files: Array<{ path: string; file: string; type: string }>;
  /** Page answered with 404 for a missing path under one of `prefixes`. */
  notFound: string;
  /** URL prefixes only the site serves (/vs/, /features/…): a missing page there is the site's 404, not the app's. */
  prefixes: string[];
  /** Directory of content-hashed assets, served immutable. */
  assetsPrefix: string;
  /** Pages built as drafts of legal terms (legal.ts lifts the draft once the operator is set). */
  legal?: string[];
}

export interface Site {
  /** Page text by URL path (`/`, `/claude`), with the placeholder origin. */
  pages: Map<string, string>;
  files: Map<string, { text: string; type: string }>;
  notFound: string;
  prefixes: string[];
  assetsPrefix: string;
  assetsDir: string;
  legal: Set<string>;
}

/** Reads a built site, or null when there is none (dev without `npm run build -w @freero/site`). */
export function loadSite(dist: string): Site | null {
  const manifestFile = path.join(dist, 'manifest.json');
  if (!fs.existsSync(manifestFile)) return null;
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as Manifest;
  if (m.version !== 1) throw new Error(`${manifestFile}: unknown site manifest version ${String(m.version)}`);
  const read = (file: string) => fs.readFileSync(path.join(dist, file), 'utf8');
  return {
    pages: new Map(m.pages.map((p) => [p.path, read(p.file)])),
    files: new Map(m.files.map((f) => [f.path, { text: read(f.file), type: f.type }])),
    notFound: read(m.notFound),
    prefixes: m.prefixes,
    assetsPrefix: m.assetsPrefix,
    assetsDir: path.join(dist, m.assetsPrefix.replace(/^\/+|\/+$/g, '')),
    legal: new Set(m.legal ?? []),
  };
}

/** `text` for `origin`. */
export const withOrigin = (text: string, origin: string): string => text.split(ORIGIN_PLACEHOLDER).join(origin);

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** A page with the operator's analytics script (SITE_ANALYTICS_SRC) added at the end of its head. */
export function withAnalytics(html: string, analytics: { src: string; attrs: Record<string, string> } | null): string {
  if (!analytics) return html;
  const attrs = Object.entries(analytics.attrs)
    .map(([k, v]) => ` data-${k}="${escapeAttr(v)}"`)
    .join('');
  return html.replace('</head>', `<script defer src="${escapeAttr(analytics.src)}"${attrs}></script></head>`);
}

/** The app's CSP, letting the analytics script's origin run and report (marketing pages only). */
export function cspWithAnalytics(csp: string, src: string): string {
  const origin = new URL(src).origin;
  return csp.replace("script-src 'self'", `script-src 'self' ${origin}`).replace(/connect-src 'self'/, `connect-src 'self' ${origin}`);
}

/** robots.txt of an instance that serves no marketing site: nothing here is for search engines. */
export const ROBOTS_NO_SITE = 'User-agent: *\nDisallow: /\n';
