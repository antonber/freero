import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { tableCellKey, type ElementType, type FrameElement, type TableCopyContent, type TableElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type NewElement } from '@engine';
import manifest from './feature';
import { TEMPLATES } from './lib/catalog';
import { addTemplate, insertTemplate } from './lib/insert';
import { boundsOf, filterTemplates, instantiate, type BoardSnapshot } from './lib/place';
import { insertSavedTemplate, saveAsTemplate } from './lib/saved';
import { specTemplates } from './lib/spec/catalog';
import { buildSpec } from './lib/spec/render';
import type { TemplateSpec } from './lib/spec/types';
import { validateSpec } from './lib/spec/validate';
import { SPEC_FILES, SPEC_INDEX } from './lib/specs';

// Spec templates load their content per file (lazily in the app); every test here builds them.
beforeAll(() => Promise.all(TEMPLATES.map((t) => t.load?.())));

// Every field of each shared element type that the engine does NOT fill in on create.
const REQUIRED: Record<ElementType, string[]> = {
  sticky: ['color', 'text', 'fontFamily', 'fontSize', 'textColor', 'align', 'vAlign'],
  shape: ['shape', 'fill', 'fillOpacity', 'stroke', 'strokeWidth', 'strokeStyle', 'text', 'fontFamily', 'fontSize', 'textColor', 'align', 'vAlign'],
  text: ['text', 'fontFamily', 'fontSize', 'textColor', 'align', 'background', 'autoWidth'],
  connector: ['start', 'end', 'routing', 'stroke', 'strokeWidth', 'strokeStyle', 'startCap', 'endCap', 'label'],
  pen: ['points', 'stroke', 'strokeWidth', 'highlighter', 'baseW', 'baseH'],
  frame: ['title', 'fill', 'index'],
  image: ['src', 'naturalW', 'naturalH'],
  card: ['title', 'description', 'color'],
  emoji: ['emoji'],
  mindmap: ['text', 'parentId', 'rootId', 'color'],
  table: ['rows', 'cols', 'header', 'fontSize'],
  embed: ['url', 'title', 'description', 'siteName', 'image', 'status'],
  icon: ['name', 'nodes', 'color', 'strokeWidth'],
  kanban: ['title', 'columns', 'colW'],
  pdf: ['src', 'name', 'page', 'pageCount'],
  swimlane: ['title', 'lanes', 'phases'],
  media: ['kind', 'src', 'name', 'size', 'duration', 'naturalW', 'naturalH'],
  file: ['src', 'name', 'size', 'mime'],
  objectlink: ['uri'],
  activity: ['kind', 'question', 'options', 'anonymous', 'results', 'guests', 'color'],
  code: ['code', 'language', 'lineNumbers', 'theme'],
  timeline: ['title', 'start', 'end', 'scale', 'lanes'],
  timelinebar: ['title', 'start', 'end', 'color'],
  doc: ['uri'],
};

let seq = 0;
const freshId = () => `id${++seq}`;
const SPOT = { x: 300, y: -200 };
const CONTAINERS: string[] = ['frame', 'kanban', 'swimlane'];

/**
 * The part of an element its text occupies. Sequence diagrams are crossed by design: messages,
 * bars and fragments run over a lifeline's stem, and a fragment's label is its corner tag.
 */
function textArea(e: NewElement): NewElement {
  if (e.type !== 'shape') return e;
  const s = e as NewElement<'shape'>;
  if (s.shape === 'umlLifeline') return { ...e, h: Math.min(52, e.h * 0.3) };
  if (s.shape === 'umlFragment') return { ...e, w: Math.min(e.w * 0.35, 88), h: Math.min(e.h * 0.22, 28) };
  return e;
}
const emptyBoard: BoardSnapshot = { place: () => SPOT, maxFrameIndex: -1 };

/** Where an attached connector end sits: a spot given as box fractions, else the side's middle. */
function endPointOf(el: NewElement, end: { anchor?: string; at?: { u: number; v: number } | null }) {
  if (end.at) return { x: el.x + end.at.u * el.w, y: el.y + end.at.v * el.h };
  return anchorOf(el, end.anchor!);
}

function anchorOf(el: NewElement, anchor: string) {
  if (anchor === 'top') return { x: el.x + el.w / 2, y: el.y };
  if (anchor === 'bottom') return { x: el.x + el.w / 2, y: el.y + el.h };
  if (anchor === 'left') return { x: el.x, y: el.y + el.h / 2 };
  return { x: el.x + el.w, y: el.y + el.h / 2 };
}

describe.each(TEMPLATES.map((t) => [t.id, t] as const))('template %s', (_id, def) => {
  it('builds only fully specified elements, so nothing renders half-initialised when an element feature lacks defaults', () => {
    const els = def.build(freshId).elements;
    expect(els.length).toBeGreaterThan(3);
    for (const el of els) {
      for (const key of ['x', 'y', 'w', 'h']) {
        const v = (el as unknown as Record<string, number>)[key];
        expect(Number.isFinite(v), `${el.type}.${key}`).toBe(true);
      }
      expect(el.w).toBeGreaterThan(0);
      expect(el.h).toBeGreaterThan(0);
      for (const key of REQUIRED[el.type]) {
        expect((el as unknown as Record<string, unknown>)[key], `${def.id}: ${el.type}.${key}`).not.toBeUndefined();
      }
    }
  });

  it('keeps every element of a frame (or kanban, or swimlane) inside it, so moving it carries the whole template', () => {
    const els = def.build(freshId).elements;
    const frames = new Map(els.filter((e) => CONTAINERS.includes(e.type)).map((f) => [f.id!, f]));
    expect(els.some((e) => e.type === 'frame')).toBe(true);
    for (const el of els) {
      if (el.type === 'frame' || !el.frameId) continue;
      const f = frames.get(el.frameId);
      expect(f, `${el.type} points at a container outside the template`).toBeDefined();
      expect(el.x).toBeGreaterThanOrEqual(f!.x);
      expect(el.y).toBeGreaterThanOrEqual(f!.y);
      expect(el.x + el.w).toBeLessThanOrEqual(f!.x + f!.w);
      expect(el.y + el.h).toBeLessThanOrEqual(f!.y + f!.h);
    }
  });

  it('never stacks one piece of text on another, so every label, note and cell stays readable', () => {
    const els = def.build(freshId).elements;
    // Text-bearing items (and icons); textless shapes are backgrounds (columns, quadrants, circles).
    const readable = els
      .filter((e) => {
        if (e.type === 'shape') return (e as NewElement<'shape'>).text !== '';
        return ['sticky', 'text', 'card', 'table', 'mindmap', 'emoji', 'icon'].includes(e.type);
      })
      .map(textArea);
    const label = (e: NewElement) => {
      const r = e as unknown as { text?: string; title?: string };
      return `${e.type} "${String(r.text ?? r.title ?? '').slice(0, 40)}"`;
    };
    for (let i = 0; i < readable.length; i++)
      for (let j = i + 1; j < readable.length; j++) {
        const a = readable[i];
        const b = readable[j];
        const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(w > 1 && h > 1, `${label(a)} overlaps ${label(b)}`).toBe(false);
      }
  });

  it('after insertion, connector, mind-map and table-cell references point at elements of the same insert, at their anchors', () => {
    const board: BoardSnapshot = { place: () => ({ x: 1234, y: -567 }), maxFrameIndex: 2 };
    const { elements: els, content } = instantiate(def, board, freshId);
    const byId = new Map(els.map((e) => [e.id!, e]));
    expect(byId.size, 'ids are unique').toBe(els.length);
    for (const el of els) {
      if (el.frameId) expect(CONTAINERS).toContain(byId.get(el.frameId)?.type);
      if (el.type === 'connector') {
        const c = el as NewElement<'connector'>;
        for (const end of [c.start, c.end]) {
          if (!end.elementId) continue;
          const target = byId.get(end.elementId);
          expect(target, 'connector end attached to a missing element').toBeDefined();
          // Cached endpoint must move with the template, or the line flashes at the old spot.
          expect(end).toMatchObject(endPointOf(target!, end));
        }
      }
      if (el.type === 'mindmap') {
        const m = el as NewElement<'mindmap'>;
        expect(byId.get(m.rootId)?.type).toBe('mindmap');
        if (m.parentId) expect(byId.get(m.parentId)?.type).toBe('mindmap');
      }
      if (el.type === 'table') {
        // A cell written for a row or column the table doesn't have would never show up.
        const t = el as NewElement<'table'>;
        const parts = new Set(t.rows.flatMap((r) => t.cols.map((c) => `${r.id}:${c.id}`)));
        for (const part of Object.keys((content[el.id!] ?? {}) as TableCopyContent)) expect(parts.has(part), `${def.id}: cell ${part}`).toBe(true);
        expect(t.w).toBe(t.cols.reduce((a, c) => a + c.w, 0));
        expect(t.h).toBe(t.rows.reduce((a, r) => a + r.h, 0));
      }
    }
    for (const id of Object.keys(content)) expect(byId.has(id), 'content for an element the template does not build').toBe(true);
  });
});

describe('inserting a template', () => {
  it('fills exactly the free spot the board found for its size, so it covers nothing (the engine keeps that spot clear)', () => {
    for (const def of TEMPLATES) {
      let asked: { w: number; h: number } | null = null;
      const placed = boundsOf(instantiate(def, { place: (size) => ((asked = size), SPOT), maxFrameIndex: -1 }, freshId).elements)!;
      expect(placed, def.id).toEqual({ x: SPOT.x, y: SPOT.y, w: asked!.w, h: asked!.h });
    }
  });

  it('twice in a row never reuses an element id (which would overwrite the first copy)', () => {
    const def = TEMPLATES[0];
    const a = instantiate(def, emptyBoard, freshId).elements.map((e) => e.id);
    const b = instantiate(def, emptyBoard, freshId).elements.map((e) => e.id);
    expect(a.filter((id) => b.includes(id))).toEqual([]);
  });

  it('a template with a table lands whole: the table inside its frame at its place, its cells filled, and one undo removes everything', () => {
    const def = TEMPLATES.find((t) => t.id === 'competitor-comparison')!;
    const Noop = () => null;
    const frameDef = { type: 'frame', Component: Noop, resize: 'free', container: true, rotatable: false, defaults: () => ({}) } as unknown as ElementDefinition<'frame'>;
    // The table feature can't be imported here; this stand-in stores pasted cells the way it does.
    const tableDef = {
      type: 'table',
      Component: Noop,
      resize: 'free',
      defaults: () => ({}),
      pasteContent: (el: TableElement, content: unknown, editor: { collection(n: string): { set(k: string, v: string): void } }) => {
        for (const [part, v] of Object.entries(content as TableCopyContent)) {
          const [r, c] = part.split(':');
          if (v.t) editor.collection('tableCells').set(tableCellKey('t', el.id, r, c), v.t);
        }
      },
    } as unknown as ElementDefinition<'table'>;
    const table: FeatureBundle = {
      manifest: { name: 'table', description: '', owns: ['tableCells'], undoable: ['tableCells'] },
      elements: [tableDef],
      tools: [],
      formats: [],
      panels: [],
      commands: [],
    };
    const shapes: FeatureBundle = { manifest: { name: 'shapes', description: '' }, elements: [frameDef], tools: [], formats: [], panels: [], commands: [] };
    const board = createTestBoard({ users: ['ann'], features: [manifest, shapes, table] });
    try {
      const [editor] = board.editors('templates');
      expect(insertTemplate(editor, def).length).toBeGreaterThan(0);
      const frame = editor.getElements().find((e) => e.type === 'frame')!;
      const t = editor.getElements().find((e): e is TableElement => e.type === 'table')!;
      expect(t.frameId, 'the table belongs to the template frame').toBe(frame.id);
      // Same offset from the frame as in the template, so it doesn't drift onto its neighbours.
      const built = def.build(freshId).elements;
      const bFrame = built.find((e) => e.type === 'frame')!;
      const bTable = built.find((e) => e.type === 'table')!;
      expect({ dx: t.x - frame.x, dy: t.y - frame.y }).toEqual({ dx: bTable.x - bFrame.x, dy: bTable.y - bFrame.y });
      const cells = editor.collection<string>('tableCells');
      const usHeader = tableCellKey('t', t.id, t.rows[0].id, t.cols[1].id);
      expect(cells.get(usHeader)).toBe('Us');

      editor.undo();
      expect(editor.getElements()).toEqual([]);
      expect(cells.get(usHeader)).toBeUndefined();
    } finally {
      board.destroy();
    }
  });

  it('a saved selection added back to the board is a new copy: frames numbered after the board’s own, in their saved order, with their items inside', async () => {
    // Minimal element types; the real ones live in other features, which tests can't import.
    const Noop = () => null;
    const frameDef = { type: 'frame', Component: Noop, resize: 'free', container: true, rotatable: false, defaults: () => ({}) } as unknown as ElementDefinition<'frame'>;
    const stickyDef = { type: 'sticky', Component: Noop, resize: 'free', defaults: () => ({}) } as unknown as ElementDefinition<'sticky'>;
    const shapes: FeatureBundle = { manifest: { name: 'shapes', description: '' }, elements: [frameDef, stickyDef], tools: [], formats: [], panels: [], commands: [] };
    const board = createTestBoard({ users: ['ann'], features: [manifest, shapes] });
    try {
      const [editor] = board.editors('templates');
      const frame = (x: number, index: number) => editor.create({ type: 'frame', x, y: 0, w: 300, h: 200, title: `F${index}`, fill: '#fff', index } as NewElement);
      const second = frame(400, 1);
      const first = frame(0, 0);
      editor.create({ type: 'sticky', x: 450, y: 50, w: 100, h: 100 } as unknown as NewElement);
      await saveAsTemplate(editor, { ids: [first, second], name: 'Two frames', description: '' });
      frame(800, 5); // the board grows after saving

      const [saved] = await editor.host.listTemplates();
      const top = await insertSavedTemplate(editor, saved.id);

      const frames = editor.getElements().filter((el): el is FrameElement => el.type === 'frame');
      const copies = frames.filter((f) => top.includes(f.id)).sort((a, b) => a.index - b.index);
      expect(copies.map((f) => [f.title, f.index])).toEqual([
        ['F0', 6],
        ['F1', 7],
      ]);
      const stickyCopy = editor.getElements().filter((el) => el.type === 'sticky').find((s) => s.frameId === copies[1].id);
      expect(stickyCopy, 'the sticky moved with its frame copy').toBeDefined();
      expect(frames.filter((f) => !top.includes(f.id)).map((f) => f.index).sort()).toEqual([0, 1, 5]); // originals untouched
    } finally {
      board.destroy();
    }
  });

  it('numbers new frames after the existing ones so presentation order keeps the old frames first', () => {
    const board: BoardSnapshot = { ...emptyBoard, maxFrameIndex: 4 };
    const frames = TEMPLATES.flatMap((d) => instantiate(d, board, freshId).elements).filter((e) => e.type === 'frame') as NewElement<'frame'>[];
    for (const f of frames) expect(f.index).toBeGreaterThan(4);
  });
});

describe('searching templates', () => {
  it('finds templates by the words people use for them, listing ones named after the query before ones that only mention it', () => {
    const retro = filterTemplates(TEMPLATES, 'retro', null).map((t) => t.id);
    expect(retro[0]).toBe('retrospective');
    expect(retro).toEqual(expect.arrayContaining(['retro-start-stop-continue', 'retro-4ls']));
    expect(filterTemplates(TEMPLATES, 'planning poker', null).map((t) => t.id)).toEqual(['relative-sizing']);
  });
});

describe('spec templates', () => {
  const all: Array<{ file: string; spec: TemplateSpec }> = [];
  beforeAll(async () => {
    for (const [file, load] of Object.entries(SPEC_FILES)) for (const spec of (await load()).default) all.push({ file, spec });
  });

  it('the picker index lists every spec file with its current names and words, so no spec goes missing from search (`npm run templates:index`)', () => {
    const onDisk = readdirSync(new URL('./lib/specs/', import.meta.url)).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => f.replace(/\.ts$/, ''));
    expect(Object.keys(SPEC_FILES).sort()).toEqual(onDisk.sort());
    const current = all.map(({ file, spec: s }) => ({ id: s.id, name: s.name, description: s.description, categories: s.categories, keywords: s.keywords, archetype: s.archetype, file }));
    expect(SPEC_INDEX).toEqual(current);
  });

  it('every spec is complete and readable (guiding prompts, real example notes, known categories and archetype, text that fits) and no two templates share an id', () => {
    expect(all.flatMap(({ spec }) => validateSpec(spec))).toEqual([]);
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('example notes stay inside their sections and sections never overlap, however much content a spec has', () => {
    const within = (a: NewElement, b: NewElement) => a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
    for (const { spec } of all) {
      const els = buildSpec(spec, freshId).elements;
      const panels = els.filter((e) => e.type === 'shape' && (e as NewElement<'shape'>).text === '');
      for (const note of els.filter((e) => e.type === 'sticky'))
        expect(panels.some((p) => within(note, p)), `${spec.id}: note "${(note as NewElement<'sticky'>).text}" spills out of its section`).toBe(true);
      for (let i = 0; i < panels.length; i++)
        for (let j = i + 1; j < panels.length; j++) {
          const [a, b] = [panels[i], panels[j]];
          const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(w > 1 && h > 1, `${spec.id}: two sections overlap at ${a.x},${a.y}`).toBe(false);
        }
    }
  });

  const spec: TemplateSpec = {
    id: 'test-columns',
    name: 'Two columns',
    description: 'A small spec for testing how spec templates load.',
    categories: ['brainstorm'],
    keywords: ['test', 'columns', 'spec'],
    hint: 'Put each idea in the column it belongs to.',
    archetype: 'columns',
    columns: [
      { title: 'Keep', prompt: 'What should we keep doing?', notes: ['Friday demos'] },
      { title: 'Change', prompt: 'What should we change?', notes: ['Shorter standups', 'Fewer status emails'] },
    ],
  };
  const entry = { id: spec.id, name: spec.name, description: spec.description, categories: spec.categories, keywords: spec.keywords, archetype: spec.archetype, file: 'f' };

  it('adding a spec template whose file has not loaded fetches it first, then lands whole in one undo step', async () => {
    let loads = 0;
    const [def] = specTemplates([entry], { f: async () => (loads++, { default: [spec] }) });
    const Noop = () => null;
    const stub = (type: string, extra = {}) => ({ type, Component: Noop, resize: 'free', defaults: () => ({}), ...extra }) as unknown as ElementDefinition;
    const shapes: FeatureBundle = {
      manifest: { name: 'shapes', description: '' },
      elements: [stub('frame', { container: true, rotatable: false }), stub('sticky'), stub('shape'), stub('text')],
      tools: [],
      formats: [],
      panels: [],
      commands: [],
    };
    const board = createTestBoard({ users: ['ann'], features: [manifest, shapes] });
    try {
      const [editor] = board.editors('templates');
      await addTemplate(editor, def);
      const types = editor.getElements().map((e) => e.type).sort();
      expect(types).toEqual(buildSpec(spec, freshId).elements.map((e) => e.type).sort());
      editor.undo();
      expect(editor.getElements()).toEqual([]);
      await addTemplate(editor, def);
      expect(loads, 'the file is fetched once, not on every insert').toBe(1);
    } finally {
      board.destroy();
    }
  });

  it('a template file that failed to load (offline, a new deploy) loads on the next try instead of failing for good', async () => {
    let offline = true;
    const [def] = specTemplates([entry], {
      f: async () => {
        if (offline) throw new Error('Failed to fetch dynamically imported module');
        return { default: [spec] };
      },
    });
    await expect(def.load!()).rejects.toThrow();
    offline = false;
    await def.load!();
    expect(def.build(freshId).elements.length).toBeGreaterThan(0);
  });
});
