// Builds the marketing site into static files: one HTML document per page (rendered once with
// react-dom/server; no client JavaScript at all), Open Graph images, sitemaps, robots.txt, llms.txt, hashed
// assets and manifest.json, which the server's modules/site reads.
//
//   npm run build -w @freero/site        → apps/site/dist
//
// Pages are discovered from src/pages/**/*.page.tsx (default export: definePage) — no list to edit.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { Document } from './components/Document';
import { ASSETS_PREFIX, emitAsset, emittedAssets, resetAssets, SRC_DIR } from './lib/assets';
import { LOGO_SVG } from './lib/brand';
import type { PageDef } from './lib/define';
import { llmsFullTxt, llmsTxt } from './lib/llms';
import { logoPng, ogImage } from './lib/og';
import { crumbsOf, jsonLdFor, LOGO_PNG_PATH, robotsTxt, sitemaps } from './lib/seo';

const require = createRequire(import.meta.url);
export const DEFAULT_OUT = path.resolve(SRC_DIR, '../dist');
/** URL prefixes that belong to the site: a missing page under them is the site's 404. */
export const SITE_PREFIXES = ['/vs/', '/features/', '/use-cases/', '/templates/'];

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

export async function discoverPages(): Promise<PageDef[]> {
  const files = walk(path.join(SRC_DIR, 'pages'))
    .filter((f) => f.endsWith('.page.tsx'))
    .sort();
  const pages: PageDef[] = [];
  for (const f of files) {
    const mod = (await import(pathToFileURL(f).href)) as { default?: PageDef };
    if (!mod.default?.path) throw new Error(`${f}: default export must be definePage({...})`);
    pages.push(mod.default);
  }
  const seen = new Set<string>();
  for (const p of pages) {
    if (seen.has(p.path)) throw new Error(`two pages at ${p.path}`);
    seen.add(p.path);
  }
  return pages;
}

/** Freero's design tokens (the app's ui/tokens.css `:root` blocks) + the site's own CSS + fonts. */
function buildCss(fonts: Record<number, string>): string {
  const tokens = fs.readFileSync(path.resolve(SRC_DIR, '../../web/src/ui/tokens.css'), 'utf8');
  const roots = [...tokens.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(^|\n):root\s*\{[^}]*\}/g)].map((m) => m[0].trim()).join('\n');
  const faces = Object.entries(fonts)
    .map(([w, url]) => `@font-face{font-family:'Inter';font-style:normal;font-weight:${w};font-display:swap;src:url(${url}) format('woff2')}`)
    .join('\n');
  const own = fs.readFileSync(path.join(SRC_DIR, 'styles/site.css'), 'utf8');
  return [faces, roots, own]
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\s*([{};,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .trim();
}

export interface BuildResult {
  outDir: string;
  pages: PageDef[];
}

export async function buildSite(outDir = DEFAULT_OUT): Promise<BuildResult> {
  resetAssets();
  const pages = await discoverPages();
  const byPath = new Map(pages.map((p) => [p.path, p]));
  if (!byPath.has('/404')) throw new Error('src/pages needs a 404 page at /404');

  const fontUrl = (w: number) => emitAsset(`fonts/inter-latin-${w}.woff2`, fs.readFileSync(require.resolve(`@fontsource/inter/files/inter-latin-${w}-normal.woff2`)));
  const fonts = { 400: fontUrl(400), 600: fontUrl(600), 700: fontUrl(700) };
  const css = buildCss(fonts);
  const favicon = emitAsset('freero.svg', Buffer.from(LOGO_SVG));
  const appleIcon = emitAsset('freero-180.png', await logoPng(180));
  LOGO_PNG_PATH.value = emitAsset('freero-512.png', await logoPng(512));

  fs.rmSync(outDir, { recursive: true, force: true });
  const write = (rel: string, data: string | Buffer) => {
    const file = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, data);
  };

  const manifestPages: Array<{ path: string; file: string }> = [];
  for (const page of pages) {
    const og = emitAsset(`og/${page.path === '/' ? 'home' : page.path.slice(1).replace(/\//g, '-')}.png`, await ogImage(page.path === '/' ? 'Free and open source' : page.name, page.ogTitle ?? page.name));
    const crumbs = crumbsOf(page, byPath);
    const html = `<!doctype html>${renderToStaticMarkup(
      <Document page={page} pages={pages} crumbs={crumbs} jsonLd={jsonLdFor(page, crumbs, og)} assets={{ css, ogImage: og, favicon, appleIcon, preloadFonts: [fonts[700]] }} />,
    )}`;
    const file = page.path === '/' ? 'index.html' : page.path === '/404' ? '404.html' : `${page.path.slice(1)}/index.html`;
    write(file, html);
    if (page.path !== '/404') manifestPages.push({ path: page.path, file });
  }

  const files: Array<{ path: string; file: string; type: string }> = [];
  for (const s of sitemaps(pages.filter((p) => p.path !== '/404'))) {
    write(s.path.slice(1), s.xml);
    files.push({ path: s.path, file: s.path.slice(1), type: 'application/xml' });
  }
  write('robots.txt', robotsTxt());
  files.push({ path: '/robots.txt', file: 'robots.txt', type: 'text/plain' });
  // For agents (llmstxt.org): what Freero is, its MCP endpoint, sign-in and tools.
  for (const [name, text] of [
    ['llms.txt', llmsTxt()],
    ['llms-full.txt', llmsFullTxt()],
  ] as const) {
    write(name, text);
    files.push({ path: `/${name}`, file: name, type: 'text/plain' });
  }

  for (const [name, bytes] of emittedAssets()) write(path.join(ASSETS_PREFIX.slice(1), name), bytes);

  write(
    'manifest.json',
    JSON.stringify({ version: 1, pages: manifestPages, files, notFound: '404.html', prefixes: SITE_PREFIXES, assetsPrefix: ASSETS_PREFIX }, null, 2),
  );
  return { outDir, pages };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const t0 = Date.now();
  buildSite(process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_OUT).then(
    (r) => console.log(`site: ${r.pages.length} pages → ${path.relative(process.cwd(), r.outDir) || r.outDir} (${Date.now() - t0} ms)`),
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
