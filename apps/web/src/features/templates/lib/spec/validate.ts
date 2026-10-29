// What a spec must satisfy before it ships: run over every spec by the tests, and the check an
// authoring tool (or a reviewer of an AI-drafted spec) runs on a draft. Limits keep text readable
// at the sizes the archetypes give it; counts keep layouts within what they were designed for.
import { CATEGORIES } from '../types';
import { ARCHETYPES } from './render';
import type { Section, TemplateSpec, Tone } from './types';

const TONES: Tone[] = ['violet', 'mint', 'coral', 'amber', 'sky', 'rose', 'gray'];
const CATEGORY_IDS = new Set<string>(CATEGORIES.map((c) => c.id));
/** Filler that means a spec isn't finished. */
const FILLER = /lorem|ipsum|placeholder|\btodo\b|xxx|\btext here\b|\bexample \d\b/i;

export function validateSpec(s: TemplateSpec): string[] {
  const out: string[] = [];
  const at = (where: string, problem: string) => out.push(`${s.id}: ${where} ${problem}`);
  const text = (where: string, v: unknown, min: number, max: number) => {
    if (typeof v !== 'string') return at(where, 'is missing');
    const t = v.trim();
    if (t.length < min || t.length > max) at(where, `must be ${min}–${max} characters (is ${t.length}: "${t.slice(0, 40)}")`);
    if (FILLER.test(t)) at(where, `reads like filler: "${t.slice(0, 40)}"`);
  };
  const count = (where: string, n: number, min: number, max: number) => {
    if (n < min || n > max) at(where, `must have ${min}–${max} entries (has ${n})`);
  };
  const tone = (where: string, t: Tone | undefined) => {
    if (t !== undefined && !TONES.includes(t)) at(where, `has unknown tone "${t}"`);
  };
  const notes = (where: string, list: string[] | undefined, min: number, max: number, len = 80) => {
    if (!Array.isArray(list)) return at(where, 'has no example notes');
    count(`${where} notes`, list.length, min, max);
    list.forEach((n, i) => text(`${where} note ${i + 1}`, n, 2, len));
  };
  const section = (where: string, sec: Section | undefined, maxNotes: number, titleMax = 36) => {
    if (!sec) return at(where, 'is missing');
    text(`${where} title`, sec.title, 1, titleMax);
    text(`${where} prompt`, sec.prompt, 10, 130);
    tone(where, sec.tone);
    notes(where, sec.notes, 1, maxNotes);
  };

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.id ?? '')) at('id', 'must be kebab-case');
  text('name', s.name, 3, 40);
  text('description', s.description, 20, 140);
  text('hint', s.hint, 20, 170);
  count('categories', s.categories?.length ?? 0, 1, 3);
  for (const c of s.categories ?? []) if (!CATEGORY_IDS.has(c)) at('categories', `has unknown category "${c}"`);
  if (new Set(s.categories).size !== s.categories?.length) at('categories', 'repeat');
  count('keywords', s.keywords?.length ?? 0, 3, 14);
  for (const kw of s.keywords ?? []) if (kw !== kw.toLowerCase() || !kw.trim() || kw.length > 40) at('keywords', `"${kw}" must be lower case, 1–40 characters`);
  if (!(s.archetype in ARCHETYPES)) {
    at('archetype', `"${s.archetype}" is not one of ${Object.keys(ARCHETYPES).join(', ')}`);
    return out;
  }

  switch (s.archetype) {
    case 'matrix':
      count('quadrants', s.quadrants.length, 4, 4);
      s.quadrants.forEach((q, i) => section(`quadrant ${i + 1}`, q, 6));
      if (s.axes) (text('x axis', s.axes.x, 2, 28), text('y axis', s.axes.y, 2, 28));
      if (s.side) section('side', s.side, 4);
      break;
    case 'columns':
      count('columns', s.columns.length, 2, 6);
      s.columns.forEach((c, i) => section(`column ${i + 1}`, c, 8));
      break;
    case 'kanban':
      count('columns', s.columns.length, 2, 6);
      s.columns.forEach((c, i) => {
        text(`column ${i + 1} title`, c.title, 1, 24);
        tone(`column ${i + 1}`, c.tone);
        count(`column ${i + 1} cards`, c.cards.length, 0, 5);
        c.cards.forEach((card, j) => (text(`column ${i + 1} card ${j + 1}`, card.title, 2, 50), card.note === undefined || text(`column ${i + 1} card ${j + 1} note`, card.note, 2, 60)));
      });
      if (s.columns.reduce((n, c) => n + c.cards.length, 0) < 3) at('columns', 'need at least 3 example cards in all');
      if (s.board !== undefined) text('board', s.board, 2, 40);
      if (s.side) section('side', s.side, 6);
      break;
    case 'canvas':
      count('cols', s.cols, 2, 4);
      count('sections', s.sections.length, 2, 12);
      s.sections.forEach((sec, i) => {
        section(`section ${i + 1}`, sec, 8);
        if (sec.span !== undefined && (sec.span < 1 || sec.span > s.cols)) at(`section ${i + 1}`, `spans ${sec.span} of ${s.cols} columns`);
      });
      break;
    case 'timeline':
      count('phases', s.phases.length, 3, 7);
      s.phases.forEach((p, i) => {
        section(`phase ${i + 1}`, p, 6, 24);
        if (p.when !== undefined) text(`phase ${i + 1} when`, p.when, 1, 20);
      });
      break;
    case 'funnel':
      count('stages', s.stages.length, 3, 6);
      s.stages.forEach((st, i) => section(`stage ${i + 1}`, st, 4, 28));
      break;
    case 'journey':
      count('stages', s.stages.length, 3, 6);
      s.stages.forEach((st, i) => text(`stage ${i + 1}`, st, 1, 22));
      count('rows', s.rows.length, 2, 6);
      s.rows.forEach((r, i) => {
        text(`row ${i + 1} title`, r.title, 1, 24);
        text(`row ${i + 1} prompt`, r.prompt, 10, 90);
        tone(`row ${i + 1}`, r.tone);
        if (r.cells.length !== s.stages.length) at(`row ${i + 1}`, `has ${r.cells.length} cells for ${s.stages.length} stages`);
        r.cells.forEach((c, j) => c === '' || text(`row ${i + 1} cell ${j + 1}`, c, 2, 80));
      });
      if (!s.rows.some((r) => r.cells.filter(Boolean).length === s.stages.length)) at('rows', 'need at least one row filled for every stage');
      break;
    case 'tree':
      text('root', s.root, 2, 26);
      count('branches', s.branches.length, 2, 6);
      s.branches.forEach((b, i) => {
        text(`branch ${i + 1}`, b.text, 2, 28);
        tone(`branch ${i + 1}`, b.tone);
        count(`branch ${i + 1} children`, b.children?.length ?? 0, 0, 4);
        (b.children ?? []).forEach((c, j) => text(`branch ${i + 1} child ${j + 1}`, c, 2, 34));
      });
      section('side', s.side, 4);
      break;
    case 'prompts':
      count('items', s.items.length, 3, 8);
      s.items.forEach((it, i) => {
        text(`item ${i + 1} prompt`, it.prompt, 8, 90);
        if (it.detail !== undefined) text(`item ${i + 1} detail`, it.detail, 8, 140);
        tone(`item ${i + 1}`, it.tone);
        notes(`item ${i + 1}`, it.notes, 1, 4);
      });
      break;
    case 'table': {
      count('columns', s.columns.length, 2, 8);
      s.columns.forEach((c, i) => {
        text(`column ${i + 1}`, c.title, 1, 30);
        if (c.w !== undefined && (c.w < 90 || c.w > 520)) at(`column ${i + 1}`, `width ${c.w} must be 90–520`);
      });
      const tw = s.columns.reduce((a, c) => a + (c.w ?? 200), 0);
      if (tw > 1900) at('columns', `are ${tw}px wide in all (at most 1900)`);
      count('rows', s.rows.length, 1, 12);
      s.rows.forEach((r, i) => {
        if (r.length > s.columns.length) at(`row ${i + 1}`, `has ${r.length} cells for ${s.columns.length} columns`);
        r.forEach((c, j) => {
          const t = typeof c === 'string' ? c : c?.t;
          if (t !== '') text(`row ${i + 1} cell ${j + 1}`, t, 1, 90);
          if (typeof c !== 'string') tone(`row ${i + 1} cell ${j + 1}`, c?.tone);
        });
      });
      if (s.side) section('side', s.side, 4);
      break;
    }
    case 'clusters':
      count('clusters', s.clusters.length, 2, 9);
      if (s.cols !== undefined) count('cols', s.cols, 1, 4);
      s.clusters.forEach((c, i) => section(`cluster ${i + 1}`, c, 6));
      break;
    case 'hub':
      section('center', s.center, 4);
      count('around', s.around.length, 3, 8);
      s.around.forEach((a, i) => section(`around ${i + 1}`, a, 4));
      break;
    case 'flow':
      count('steps', s.steps.length, 3, 7);
      text('notes label', s.notesLabel, 3, 80);
      s.steps.forEach((st, i) => {
        text(`step ${i + 1}`, st.title, 2, 32);
        tone(`step ${i + 1}`, st.tone);
        notes(`step ${i + 1}`, st.notes, 1, 3, 70);
      });
      break;
  }
  return out;
}
