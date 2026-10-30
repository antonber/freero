// The template quality gate: what every built-in template must pass before it ships, run over the
// whole catalog by the templates tests (so by `npm run check`). Each check returns problems as
// "<template id>: <what is wrong>" so a failing run says which template to fix and how.
//
// - metadataProblems: what the picker, search and the site's template pages need (name,
//   description, known categories, keywords, a URL-safe id). Specs also need their how-to text
//   (`hint`), checked by validateSpec with the rest of a spec's content.
// - layoutProblems: the template as actually laid out: everything inside its frame, no text
//   stacked on other text, and text that fits its box at a readable size.
// - sectionProblems: spec layouts only: notes inside their section, sections apart, none empty.
// - duplicateProblems: two templates a person couldn't tell apart (near-identical names), the same
//   layout with near-identical section titles, or near-identical content under another name.
// - indexProblems: the picker's index (`npm run templates:index`) out of step with the specs.
//
// Similarity is deliberately simple and explainable: the overlap of two word sets (Jaccard:
// shared words / all words), after lower-casing, dropping filler words and plural/-ing endings.
import type { TableCopyContent } from '@freero/shared';
import type { NewElement } from '@engine';
import { lineCount } from './spec/blocks';
import type { SpecIndexEntry, TemplateSpec } from './spec/types';
import { CATEGORIES, type BuiltTemplate, type TemplateDef } from './types';

const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
/** Filler that means a template isn't finished. */
export const FILLER = /lorem|ipsum|placeholder|\btodo\b|xxx|\btext here\b|\bexample \d\b/i;
/** A template's address on the site and in links: lower-case words joined by single hyphens. */
const URL_SAFE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// ── Metadata ─────────────────────────────────────────────────────────────────────────────────
export type TemplateMeta = Pick<TemplateDef, 'id' | 'name' | 'description' | 'categories' | 'keywords'>;

export function metadataProblems(t: TemplateMeta): string[] {
  const out: string[] = [];
  const at = (where: string, problem: string) => out.push(`${t.id}: ${where} ${problem}`);
  const text = (where: string, v: unknown, min: number, max: number) => {
    if (typeof v !== 'string' || !v.trim()) return at(where, 'is missing');
    const s = v.trim();
    if (s.length < min || s.length > max) at(where, `must be ${min}–${max} characters (is ${s.length}: "${s.slice(0, 40)}")`);
    if (FILLER.test(s)) at(where, `reads like filler: "${s.slice(0, 40)}"`);
  };
  if (typeof t.id !== 'string' || !URL_SAFE.test(t.id) || t.id.length > 60) at('id', `"${t.id}" must be URL-safe: lower-case words joined by hyphens, at most 60 characters`);
  text('name', t.name, 3, 40);
  text('description', t.description, 20, 140);
  if (typeof t.description === 'string' && t.description.trim().toLowerCase() === String(t.name).trim().toLowerCase()) at('description', 'only repeats the name');
  const cats = Array.isArray(t.categories) ? t.categories : [];
  if (cats.length < 1 || cats.length > 3) at('categories', `must have 1–3 entries (has ${cats.length})`);
  for (const c of cats) if (!CATEGORY_IDS.has(c)) at('categories', `has unknown category "${c}" (known: ${[...CATEGORY_IDS].join(', ')})`);
  if (new Set(cats).size !== cats.length) at('categories', 'repeat');
  const kws = Array.isArray(t.keywords) ? t.keywords : [];
  if (kws.length < 3 || kws.length > 14) at('keywords', `must have 3–14 entries (has ${kws.length})`);
  for (const kw of kws) if (typeof kw !== 'string' || kw !== kw.toLowerCase() || !kw.trim() || kw.length > 40) at('keywords', `"${kw}" must be lower case, 1–40 characters`);
  if (new Set(kws).size !== kws.length) at('keywords', 'repeat');
  return out;
}

// ── Layout ───────────────────────────────────────────────────────────────────────────────────
const CONTAINERS = new Set(['frame', 'kanban', 'swimlane']);
const READABLE = new Set(['sticky', 'text', 'card', 'table', 'mindmap', 'emoji', 'icon']);
/** Smallest size an auto-fitting note may shrink to and still be read at a normal zoom. */
export const MIN_NOTE_FONT = 14;
/** Line height of rendered text (engine/text: LINE_HEIGHT). */
const LH = 1.3;

/** Plain text of an element's rich-text field, one entry per line, marked bold when the whole line is. */
function lines(html: string): Array<{ text: string; bold: boolean }> {
  return html
    .split(/<br\s*\/?>|<\/p>|<\/li>/i)
    .map((l) => ({ text: decode(l.replace(/<[^>]+>/g, '')), bold: /^\s*(<[^>]+>)*\s*<(b|strong)>/i.test(l) }))
    .filter((l) => l.text.trim() !== '');
}

function decode(s: string): string {
  return s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

const plain = (html: string) =>
  lines(html)
    .map((l) => l.text)
    .join(' ');

/**
 * Average width of a character of sentence text in Inter, in em, at the wide end of what
 * Chromium measures (0.44–0.52 regular, about 3% more bold). The archetypes lay out with a more
 * generous estimate (blocks.ts) so they never come up short; the gate only rejects text that
 * really won't fit.
 */
const EM = { regular: 0.52, bold: 0.54 };

/** Height `html` needs at `size` px in a box `w` wide. */
function neededHeight(html: string, w: number, size: number): number {
  return lines(html).reduce((h, l) => h + lineCount(l.text, w, size, l.bold, l.bold ? EM.bold : EM.regular), 0) * size * LH;
}

/** The part of an element its text occupies. Sequence diagrams are crossed by design: messages, bars and fragments run over a lifeline's stem, and a fragment's label is its corner tag. */
function textArea(e: NewElement): NewElement {
  if (e.type !== 'shape') return e;
  const s = e as NewElement<'shape'>;
  if (s.shape === 'umlLifeline') return { ...e, h: Math.min(52, e.h * 0.3) };
  if (s.shape === 'umlFragment') return { ...e, w: Math.min(e.w * 0.35, 88), h: Math.min(e.h * 0.22, 28) };
  return e;
}

/**
 * Where a shape draws its text, for the kinds templates put text in (the shape feature's text
 * boxes, kept conservative). Other kinds aren't checked.
 */
function shapeTextBox(kind: string, w: number, h: number): { w: number; h: number } | null {
  if (kind === 'roundRect' || kind === 'rect') return { w, h };
  if (kind === 'ellipse') return { w: w * 0.708, h: h * 0.708 };
  if (kind === 'chevron') {
    const d = Math.min(w * 0.4, h * 0.5);
    return { w: Math.max(1, w - 2 * d + d * 0.5), h };
  }
  if (kind === 'diamond') return { w: w * 0.5, h: h * 0.5 };
  return null;
}

const label = (e: NewElement) => {
  const r = e as unknown as { text?: string; title?: string };
  return `${e.type} "${plain(String(r.text ?? r.title ?? '')).slice(0, 40)}"`;
};

const overlap = (a: NewElement, b: NewElement) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
const inside = (a: NewElement, b: NewElement) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;

/**
 * Where a text element's lines end up: the text feature re-measures a text box's height on
 * insert, so text that wraps to more lines than it was given room for grows downwards. Its
 * padding (features/text: 0.3 em) is clearance, so only the lines count.
 */
function settled(e: NewElement): NewElement {
  if (e.type !== 'text') return e;
  const t = e as NewElement<'text'>;
  const pad = Math.max(2, t.fontSize * 0.3);
  return { ...e, y: e.y + pad, h: Math.max(e.h - 2 * pad, Math.round(neededHeight(t.text, e.w - 2 * pad, t.fontSize))) };
}

/** Text in a fixed-size box (a note, a shape) that can't be read there, or null. */
function overflow(e: NewElement): string | null {
  if (e.type === 'sticky') {
    const s = e as NewElement<'sticky'>;
    const pad = Math.max(8, Math.min(e.w, e.h) * 0.08);
    const size = s.fontSize === 'auto' ? MIN_NOTE_FONT : s.fontSize;
    const need = neededHeight(s.text, e.w - 2 * pad, size);
    if (need > e.h - 2 * pad + 1) return `doesn't fit its ${Math.round(e.w)}×${Math.round(e.h)} note even at ${size}px (needs ${Math.round(need)}px of ${Math.round(e.h - 2 * pad)}): shorten it`;
  }
  if (e.type === 'shape') {
    const s = e as NewElement<'shape'>;
    if (!s.text || typeof s.fontSize !== 'number') return null;
    const box = shapeTextBox(s.shape, e.w, e.h);
    if (!box) return null;
    const pad = Math.max(4, Math.min(box.w, box.h) * 0.07) + s.strokeWidth / 2;
    const need = neededHeight(s.text, box.w - 2 * pad, s.fontSize);
    // Half the padding may go: it is clearance, not where the glyphs are drawn.
    if (need > box.h - pad + 1) return `overflows its ${s.shape} (needs ${Math.round(need)}px of ${Math.round(box.h - pad)})`;
  }
  return null;
}

/**
 * Problems with any template as laid out: items outside their frame, text on text (text boxes
 * counted at the height they grow to for their text), text that doesn't fit its note or shape.
 */
export function layoutProblems(id: string, built: BuiltTemplate): string[] {
  const out: string[] = [];
  const given = new Map(built.elements.map((e) => [e.id, e]));
  const els = built.elements.map(settled);
  const grew = (e: NewElement) => {
    const was = given.get(e.id);
    if (e.type !== 'text' || !was) return '';
    const room = was.h - 2 * Math.max(2, (was as NewElement<'text'>).fontSize * 0.3);
    return e.h > room + 1 ? ` (its lines need ${Math.round(e.h)}px, it has room for ${Math.round(room)}px)` : '';
  };
  if (!els.some((e) => e.type === 'frame')) out.push(`${id}: has no frame, so it can't be moved or presented as one piece`);
  const containers = new Map(els.filter((e) => CONTAINERS.has(e.type)).map((f) => [f.id!, f]));
  for (const el of els) {
    if (el.type === 'frame' || !el.frameId) continue;
    const f = containers.get(el.frameId);
    if (!f) out.push(`${id}: ${label(el)} belongs to a container outside the template`);
    else if (!inside(el, f)) out.push(`${id}: ${label(el)} sticks out of its ${f.type} at ${Math.round(el.x)},${Math.round(el.y)}${grew(el)}`);
  }
  const readable = els.filter((e) => (e.type === 'shape' ? (e as NewElement<'shape'>).text !== '' : READABLE.has(e.type))).map(textArea);
  for (let i = 0; i < readable.length; i++)
    for (let j = i + 1; j < readable.length; j++)
      if (overlap(readable[i], readable[j])) out.push(`${id}: ${label(readable[i])}${grew(readable[i])} overlaps ${label(readable[j])}${grew(readable[j])}`);
  for (const el of els) {
    const why = overflow(el);
    if (why) out.push(`${id}: ${label(el)} ${why}`);
  }
  return out;
}

/** Spec layouts: every note sits in a section, sections don't overlap, and no section is left empty. */
export function sectionProblems(id: string, built: BuiltTemplate): string[] {
  const out: string[] = [];
  const els = built.elements;
  const panels = els.filter((e) => e.type === 'shape' && (e as NewElement<'shape'>).text === '');
  const notes = els.filter((e) => e.type === 'sticky');
  for (const n of notes) if (!panels.some((p) => inside(n, p))) out.push(`${id}: ${label(n)} spills out of its section`);
  for (let i = 0; i < panels.length; i++)
    for (let j = i + 1; j < panels.length; j++)
      if (overlap(panels[i], panels[j])) out.push(`${id}: two sections overlap at ${Math.round(panels[i].x)},${Math.round(panels[i].y)}`);
  for (const p of panels)
    if (!notes.some((n) => inside(n, p))) {
      const title = els.find((e) => e.type === 'text' && inside(e, p));
      out.push(`${id}: section ${title ? label(title) : `at ${Math.round(p.x)},${Math.round(p.y)}`} has no example notes`);
    }
  return out;
}

// ── Duplicates ───────────────────────────────────────────────────────────────────────────────
const STOP = new Set(
  'a an and are as at be but by can do does for from has have how i if in into is it its me my not of on or our so than that the their them then there these they this to up us was we were what when where which who why will with you your'.split(' '),
);
/** Words that say what kind of page a template is, not what it is for ("Empathy map" ≈ "Empathy board"). */
const GENERIC = new Set('template board canvas map chart sheet worksheet diagram view page wall grid'.split(' '));

function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 5 && w.endsWith('ing')) {
    const s = w.slice(0, -3);
    return /([^aeiou])\1$/.test(s) ? s.slice(0, -1) : s;
  }
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/** The meaningful words of `text`, normalised. */
export function wordSet(text: string, drop: Set<string> = STOP): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || drop.has(raw)) continue;
    const w = stem(raw);
    if (!drop.has(w)) out.add(w);
  }
  return out;
}

/** Shared words / all words. */
export function similarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

/** Names this alike read as the same template in a list. */
export const SAME_NAME = 0.8;
/** The same archetype with section titles this alike is the same template with new example notes. */
export const SAME_SECTIONS = 0.6;
/** This much of the same wording (titles, prompts, notes) is a renamed copy. */
export const SAME_CONTENT = 0.45;

export interface Fingerprint {
  id: string;
  name: string;
  /** A spec's archetype; hand-coded templates are each their own layout. */
  layout: string;
  /** Section, column, stage or step titles (specs). */
  sections: string[];
  /** Every word the built template shows. */
  text: string;
}

/** The titles that give a spec its structure, by archetype. */
export function sectionTitles(s: TemplateSpec): string[] {
  switch (s.archetype) {
    case 'matrix':
      return [...s.quadrants.map((q) => q.title), ...(s.axes ? [s.axes.x, s.axes.y] : [])];
    case 'columns':
      return s.columns.map((c) => c.title);
    case 'kanban':
      return s.columns.map((c) => c.title);
    case 'canvas':
      return s.sections.map((c) => c.title);
    case 'timeline':
      return s.phases.map((c) => c.title);
    case 'funnel':
      return s.stages.map((c) => c.title);
    case 'journey':
      return [...s.stages, ...s.rows.map((r) => r.title)];
    case 'tree':
      return [s.root, ...s.branches.map((b) => b.text)];
    case 'prompts':
      return s.items.map((i) => i.prompt);
    case 'table':
      return s.columns.map((c) => c.title);
    case 'clusters':
      return s.clusters.map((c) => c.title);
    case 'hub':
      return [s.center.title, ...s.around.map((a) => a.title)];
    case 'flow':
      return s.steps.map((st) => st.title);
  }
}

/** All text a built template shows: element text, titles and table cells. */
export function builtText(built: BuiltTemplate): string {
  const parts: string[] = [];
  for (const e of built.elements) {
    const r = e as unknown as Record<string, unknown>;
    for (const k of ['text', 'title', 'description', 'label']) if (typeof r[k] === 'string') parts.push(plain(r[k] as string));
  }
  for (const c of Object.values(built.content)) for (const cell of Object.values((c ?? {}) as TableCopyContent)) if (cell && typeof cell.t === 'string') parts.push(plain(cell.t));
  return parts.join(' ');
}

export function fingerprint(def: TemplateMeta, built: BuiltTemplate, spec?: TemplateSpec): Fingerprint {
  return { id: def.id, name: def.name, layout: spec ? spec.archetype : `custom:${def.id}`, sections: spec ? sectionTitles(spec) : [], text: builtText(built) };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const sample = (a: Set<string>, b: Set<string>) =>
  [...a]
    .filter((w) => b.has(w))
    .slice(0, 6)
    .join(', ');

/** Pairs of templates people couldn't tell apart, each reported on the later one (the one to change). */
export function duplicateProblems(prints: Fingerprint[]): string[] {
  const out: string[] = [];
  const sets = prints.map((p) => {
    const name = wordSet(p.name, new Set([...STOP, ...GENERIC]));
    return { p, name: name.size ? name : wordSet(p.name), id: p.id.replace(/[^a-z0-9]/g, ''), sections: wordSet(p.sections.join(' ')), text: wordSet(p.text) };
  });
  for (let j = 0; j < sets.length; j++)
    for (let i = 0; i < j; i++) {
      const [a, b] = [sets[i], sets[j]];
      const said = (why: string) => out.push(`${b.p.id}: too close to "${a.p.id}" (${a.p.name}): ${why}. Make it a different template or improve the existing one instead.`);
      if (a.id === b.id) said('the ids differ only in punctuation');
      else if (similarity(a.name, b.name) >= SAME_NAME) said(`the names share ${pct(similarity(a.name, b.name))} of their words (${sample(a.name, b.name)})`);
      else if (a.p.layout === b.p.layout && a.sections.size >= 3 && b.sections.size >= 3 && similarity(a.sections, b.sections) >= SAME_SECTIONS)
        said(`same ${a.p.layout} layout with ${pct(similarity(a.sections, b.sections))} of the same section words (${sample(a.sections, b.sections)})`);
      else if (similarity(a.text, b.text) >= SAME_CONTENT) said(`${pct(similarity(a.text, b.text))} of the same wording (${sample(a.text, b.text)}…)`);
    }
  return out;
}

// ── Index ────────────────────────────────────────────────────────────────────────────────────
/** What the index must say about a spec (see scripts/templates-index.mjs). */
export const indexEntryOf = (s: TemplateSpec, file: string): SpecIndexEntry => ({
  id: s.id,
  name: s.name,
  description: s.description,
  categories: s.categories,
  keywords: s.keywords,
  archetype: s.archetype,
  file,
});

/** The picker index against the spec files on disk: every spec listed, as it is now, in file order. */
export function indexProblems(index: SpecIndexEntry[], indexFiles: string[], specs: Array<{ file: string; spec: TemplateSpec }>, filesOnDisk: string[]): string[] {
  const out: string[] = [];
  const fix = 'run `npm run templates:index`';
  for (const f of filesOnDisk) if (!indexFiles.includes(f)) out.push(`specs/${f}.ts: not in the index, so none of its templates can load: ${fix}`);
  for (const f of indexFiles) if (!filesOnDisk.includes(f)) out.push(`specs/${f}.ts: in the index but not on disk: ${fix}`);
  const listed = new Map(index.map((e) => [e.id, e]));
  const current = specs.map(({ file, spec }) => indexEntryOf(spec, file));
  for (const e of current) {
    const was = listed.get(e.id);
    if (!was) out.push(`${e.id}: missing from the index, so the picker and search never show it: ${fix}`);
    else {
      const stale = (Object.keys(e) as Array<keyof SpecIndexEntry>).filter((k) => JSON.stringify(e[k]) !== JSON.stringify(was[k]));
      if (stale.length) out.push(`${e.id}: the index has an old ${stale.join(', ')}: ${fix}`);
    }
  }
  const ids = new Set(current.map((e) => e.id));
  for (const e of index) if (!ids.has(e.id)) out.push(`${e.id}: in the index but no spec has it any more: ${fix}`);
  if (!out.length && current.some((e, i) => index[i]?.id !== e.id)) out.push(`the index lists templates out of their file order: ${fix}`);
  return out;
}
