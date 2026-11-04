// Public API of modules/site [S2]: pages of the marketing site other modules fill with their own
// data (#162: the community template gallery's public pages). They are served exactly like the
// built pages — origin, legal state, CSP, analytics (served.ts) — and filled here, escaped for
// every context a value lands in.
import type { Request, Response } from 'express';
import type { Config } from '../../platform/config';
import { servedSite } from './served';

/** The placeholders a page shell is built with (apps/site build.tsx `SHELL_PLACEHOLDERS`). */
export const SHELL = {
  title: '__freero_shell_title__',
  description: '__freero_shell_description__',
  name: '__freero_shell_name__',
  path: '/__freero_shell_path__',
} as const;

export interface ShellFill {
  /** <title>, og:title, the JSON-LD page name. */
  title: string;
  description: string;
  /** The last breadcrumb. */
  name: string;
  /** The page's own path (canonical, og:url): only URL-safe characters. */
  path: string;
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
/** Inside a JSON string in a <script> element: JSON escapes, and nothing that could close the element. */
const escapeJson = (s: string) => JSON.stringify(s).slice(1, -1).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
const LD = /(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g;

function fillText(text: string, fill: ShellFill, escape: (s: string) => string): string {
  return text
    .split(SHELL.title).join(escape(fill.title))
    .split(SHELL.description).join(escape(fill.description))
    .split(SHELL.name).join(escape(fill.name))
    .split(SHELL.path).join(fill.path);
}

/**
 * A shell with its placeholders filled — HTML-escaped in the markup, JSON-escaped in the JSON-LD —
 * and its `data-freero-slot` element replaced by `body` (markup the caller built and escaped).
 * Pure; exported for tests.
 */
export function fillShell(html: string, fill: ShellFill, body: string): string {
  if (!/^\/[A-Za-z0-9/_-]*$/.test(fill.path)) throw new Error(`fillShell: unsafe path ${fill.path}`);
  const parts: string[] = [];
  let last = 0;
  for (const m of html.matchAll(LD)) {
    parts.push(fillText(html.slice(last, m.index), fill, escapeHtml), m[1], fillText(m[2], fill, escapeJson), m[3]);
    last = m.index! + m[0].length;
  }
  parts.push(fillText(html.slice(last), fill, escapeHtml));
  return fillSlot(parts.join(''), 'body', body);
}

/** `html` with its `<div data-freero-slot="<slot>"></div>` replaced by `body`. */
export function fillSlot(html: string, slot: string, body: string): string {
  const marker = `<div data-freero-slot="${slot}"></div>`;
  return html.split(marker).join(body);
}

/** A built page's text for this request (origin and legal filled), or null: no site build, or no such page. */
export function sitePageText(config: Config, req: Request, path: string): string | null {
  const s = servedSite(config);
  const raw = s.site?.pages.get(path);
  return raw === undefined ? null : s.textFor(req, path, raw);
}

/** A page shell of the build for this request (origin filled; placeholders still in), or null. */
export function siteShellText(config: Config, req: Request, name: string): string | null {
  const s = servedSite(config);
  const raw = s.site?.shells.get(name);
  return raw === undefined ? null : s.textFor(req, `shell:${name}`, raw);
}

/** Sends a page of the site the caller filled. */
export function sendSiteHtml(config: Config, req: Request, res: Response, html: string, opts?: { status?: number; noindex?: boolean }): void {
  servedSite(config).sendHtml(req, res, html, opts);
}

/** Sends the site's 404 page; false when there is no site build (the caller answers otherwise). */
export function sendSiteNotFound(config: Config, req: Request, res: Response): boolean {
  const s = servedSite(config);
  if (!s.site) return false;
  s.sendPage(req, res, '404', s.site.notFound, 404);
  return true;
}
