// The site's view of the app's built-in template catalog (apps/web/src/features/templates: the same
// list the board's Templates panel shows). /templates and one page per template are generated from
// it at build time, so a template added there gets its page, preview, sitemap entry and index card
// with no edit here.
//
// Each template is BUILT here exactly as the board builds it on insert, and its page is made from
// that: the instruction line under its title, the parts it lays out (section titles and their
// guiding questions, kanban columns, table columns, a mind map's branches) and the preview, which is
// the Templates panel's own thumbnail renderer (`TemplatePreview`) written to a static SVG file.
// That costs a few milliseconds and ~5 KB per template, so thousands of templates stay cheap.
//
// The catalog is imported from its source by path (like the server's modules/outline reads the
// features' outline.ts): the site doesn't type-check the web app, so the shapes it reads are
// declared below; a change to them fails the site's build and tests, not silently.
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { richTextToPlain } from '@freero/shared';
import { emitAsset, SRC_DIR } from './assets';
import { abs, APP } from './site';

const LIB = path.resolve(SRC_DIR, '../../web/src/features/templates/lib');

/** What the site reads of a built element (`NewElement` in the app). */
interface BuiltElement {
  id?: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  title?: string;
  fontSize?: number | 'auto';
  textColor?: string;
  parentId?: string | null;
  columns?: Array<{ title: string }>;
  lanes?: Array<{ title: string }>;
  rows?: Array<{ id: string }>;
  cols?: Array<{ id: string }>;
  header?: boolean;
}

/** `TemplateDef` in the app (features/templates/lib/types.ts). */
interface CatalogTemplate {
  id: string;
  name: string;
  description: string;
  categories: string[];
  keywords: string[];
  load?(): Promise<void>;
  build(newId: () => string): { elements: BuiltElement[]; content: Record<string, unknown> };
}

const load = async <T,>(rel: string): Promise<T> => (await import(pathToFileURL(path.join(LIB, rel)).href)) as T;
const [{ TEMPLATES }, { CATEGORIES }, { INK_SOFT }, { TemplatePreview }] = await Promise.all([
  load<{ TEMPLATES: CatalogTemplate[] }>('catalog/index.ts'),
  load<{ CATEGORIES: Array<{ id: string; label: string }> }>('types.ts'),
  load<{ INK_SOFT: string }>('palette.ts'),
  load<{ TemplatePreview: ComponentType<{ def: CatalogTemplate }> }>('Preview.tsx'),
]);
// Spec templates keep their content in a file per area, loaded before they build (as on a board).
await Promise.all(TEMPLATES.map((t) => t.load?.()));

export interface TemplateCategory {
  id: string;
  label: string;
}

/** One part of a template's layout: a section, a column, a kanban, a table, a mind map. */
export interface TemplatePart {
  title: string;
  /** Its guiding question or what it holds. */
  detail?: string;
}

export interface SiteTemplate {
  id: string;
  name: string;
  description: string;
  /** Where the Templates panel lists it (its first category). */
  category: TemplateCategory;
  categories: TemplateCategory[];
  keywords: string[];
  /** The instruction line under the template's title on the board. */
  hint: string;
  parts: TemplatePart[];
  /** The preview SVG (built once; emitted as a file when a page shows it). */
  svg: { bytes: Buffer; width: number; height: number };
}

/** Board rich text as one line of plain text. */
const plain = (html: string) =>
  richTextToPlain(html)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');

const BOLD_ONLY = /^<b>([^<]+)<\/b>(?:<br>([\s\S]*))?$/;
const isGuide = (e: BuiltElement | undefined) => e?.type === 'text' && e.textColor?.toUpperCase() === INK_SOFT.toUpperCase() && typeof e.fontSize === 'number' && e.fontSize <= 16;
/** At most `max` characters, cut at a word. */
export const clip = (s: string, max = 140) => (s.length > max ? `${s.slice(0, Math.max(s.lastIndexOf(' ', max - 1), max / 2)).replace(/[,;:.\s]+$/, '')}…` : s);
const list = (items: string[]) => items.map((s) => plain(s)).filter(Boolean).join(' · ');

/** The instruction line and the parts of a built template, in the order the board lays them out. */
export function readTemplate(built: { elements: BuiltElement[]; content: Record<string, unknown> }): { hint: string; parts: TemplatePart[] } {
  const els = built.elements;
  let hint = '';
  const parts: TemplatePart[] = [];
  /** The last heading without a guiding question yet: the next grey line under it is its question. */
  let open = -1;
  const add = (p: TemplatePart) => {
    open = -1;
    // A WIP limit's "3" or an axis arrow alone is not a part.
    if (!/\p{L}{2}/u.test(p.title) || parts.some((x) => x.title === p.title && x.detail === p.detail)) return;
    parts.push(p);
    if (!p.detail) open = parts.length - 1;
  };
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    const size = typeof e.fontSize === 'number' ? e.fontSize : 0;
    if (e.type === 'text' && size >= 28 && !hint) {
      // The template's heading; the grey line under it says how to use the template.
      if (isGuide(els[i + 1])) hint = plain(els[++i].text ?? '');
      continue;
    }
    if (isGuide(e)) {
      if (open >= 0) parts[open].detail = clip(plain(e.text ?? ''));
      open = -1;
      continue;
    }
    const m = (e.type === 'text' && size >= 17 && size < 28) || e.type === 'shape' ? BOLD_ONLY.exec(e.text ?? '') : null;
    if (m) {
      const rest = m[2] ? plain(m[2]) : '';
      add({ title: plain(m[1]), ...(rest ? { detail: clip(rest) } : {}) });
    } else if (e.type === 'kanban' && e.columns?.length) {
      add({ title: plain(e.title ?? '') || 'Kanban', detail: `Columns: ${list(e.columns.map((c) => c.title))}` });
    } else if (e.type === 'swimlane' && e.lanes?.length) {
      add({ title: plain(e.title ?? '') || 'Swimlanes', detail: `Lanes: ${list(e.lanes.map((l) => l.title))}` });
    } else if (e.type === 'table' && e.header !== false && e.rows?.length && e.cols?.length) {
      const cells = (built.content[e.id ?? ''] ?? {}) as Record<string, { t?: string }>;
      const head = e.cols.map((c) => cells[`${e.rows![0].id}:${c.id}`]?.t ?? '').filter(Boolean);
      if (head.length) add({ title: 'Table', detail: `Columns: ${list(head)}` });
    } else if (e.type === 'mindmap' && !e.parentId) {
      const branches = els.filter((c) => c.type === 'mindmap' && c.parentId === e.id).map((c) => c.text ?? '');
      add({ title: plain(e.text ?? ''), ...(branches.length ? { detail: `Branches: ${list(branches)}` } : {}) });
    }
  }
  return { hint, parts: parts.slice(0, 14) };
}

/** The Templates panel's thumbnail as a standalone SVG file (rounded numbers, its own size). */
function previewSvg(def: CatalogTemplate): SiteTemplate['svg'] {
  const markup = renderToStaticMarkup(createElement(TemplatePreview, { def }));
  const viewBox = /viewBox="([^"]+)"/.exec(markup)?.[1].split(/\s+/).map(Number);
  if (!viewBox || viewBox.length !== 4) throw new Error(`template ${def.id}: its preview has no viewBox`);
  const width = 800;
  const height = Math.max(1, Math.round((width * viewBox[3]) / viewBox[2]));
  const svg = markup
    .replace(/^<svg[^>]*?(viewBox="[^"]+")[^>]*>/, (_m, vb: string) => `<svg xmlns="http://www.w3.org/2000/svg" ${vb} width="${width}" height="${height}">`)
    .replace(/-?\d+\.\d{2,}/g, (n) => String(Math.round(Number(n) * 10) / 10));
  return { bytes: Buffer.from(svg), width, height };
}

const categoryById = new Map(CATEGORIES.map((c) => [c.id, c]));

export const TEMPLATE_CATEGORIES: TemplateCategory[] = CATEGORIES;

export const SITE_TEMPLATES: SiteTemplate[] = TEMPLATES.map((def) => {
  let n = 0;
  const { hint, parts } = readTemplate(def.build(() => `s${n++}`));
  const categories = def.categories.map((c) => {
    const cat = categoryById.get(c);
    if (!cat) throw new Error(`template ${def.id}: unknown category "${c}"`);
    return cat;
  });
  return { id: def.id, name: def.name, description: def.description, category: categories[0], categories, keywords: def.keywords, hint, parts, svg: previewSvg(def) };
});

const byId = new Map(SITE_TEMPLATES.map((t) => [t.id, t]));

/** A template by id; throws for an id the catalog doesn't have (a use case naming a removed one). */
export function templateById(id: string): SiteTemplate {
  const t = byId.get(id);
  if (!t) throw new Error(`no template "${id}" in the catalog (apps/web/src/features/templates)`);
  return t;
}

export const templatePath = (id: string) => `/templates/${id}`;
export const categoryAnchor = (id: string) => `category-${id}`;
/** Templates the index lists under a category: those whose FIRST category it is, as the panel does. */
export const templatesIn = (categoryId: string) => SITE_TEMPLATES.filter((t) => t.category.id === categoryId);

/**
 * "Use this template": sign up (or straight through when signed in), then a new board with this
 * template on it (the dashboard's `/app?template=<id>` opens a board with `?template=<id>`, which the
 * templates feature fills).
 */
export const useTemplateHref = (id: string) => `${APP.signup}?next=${encodeURIComponent(`${APP.boards}?template=${id}`)}`;

/** The preview's public URL (a hashed, immutable file). */
export function previewOf(t: SiteTemplate): { src: string; width: number; height: number } {
  return { src: emitAsset(`templates/${t.id}.svg`, t.svg.bytes), width: t.svg.width, height: t.svg.height };
}

/** Other templates to suggest on a template's page: its first category first, then shared words. */
export function relatedTo(t: SiteTemplate, max = 6): SiteTemplate[] {
  const words = new Set(t.keywords);
  const cats = new Set(t.categories.map((c) => c.id));
  return SITE_TEMPLATES.filter((o) => o.id !== t.id)
    .map((o, i) => ({
      o,
      i,
      score: (o.category.id === t.category.id ? 4 : 0) + o.categories.filter((c) => cats.has(c.id)).length + o.keywords.filter((k) => words.has(k)).length * 2,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, max)
    .map((x) => x.o);
}

export function TemplatePreviewImage({ t, eager, alt }: { t: SiteTemplate; eager?: boolean; alt?: string }) {
  const p = previewOf(t);
  return (
    <img
      className="tpl-preview"
      src={p.src}
      width={p.width}
      height={p.height}
      alt={alt ?? `Preview of the ${t.name} template: its layout as it lands on the board`}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
    />
  );
}

export function TemplateCards({ templates }: { templates: readonly SiteTemplate[] }) {
  return (
    <ul className="tpl-cards">
      {templates.map((t) => (
        <li key={t.id} className="tpl-card">
          <span className="tpl-card__thumb">
            <TemplatePreviewImage t={t} alt={`Preview of the ${t.name} template`} />
          </span>
          <h3 className="tpl-card__title">
            <a href={templatePath(t.id)}>{t.name}</a>
          </h3>
          <p>{t.description}</p>
        </li>
      ))}
    </ul>
  );
}

/** schema.org ItemList of the catalog (the index page). */
export function templatesItemList(): Record<string, unknown> {
  return {
    '@type': 'ItemList',
    '@id': `${abs('/templates')}#list`,
    name: 'Freero whiteboard templates',
    numberOfItems: SITE_TEMPLATES.length,
    itemListElement: SITE_TEMPLATES.map((t, n) => ({ '@type': 'ListItem', position: n + 1, name: t.name, url: abs(templatePath(t.id)) })),
  };
}
