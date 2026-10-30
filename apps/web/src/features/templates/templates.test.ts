import { readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { tableCellKey, type ElementType, type FrameElement, type TableCopyContent, type TableElement } from '@freero/shared';
import { createTestBoard, type ElementDefinition, type FeatureBundle, type NewElement } from '@engine';
import commands from './commands';
import manifest from './feature';
import { TEMPLATES } from './lib/catalog';
import { addTemplate, insertTemplate } from './lib/insert';
import { boundsOf, filterTemplates, instantiate, type BoardSnapshot } from './lib/place';
import { insertSavedTemplate, saveAsTemplate } from './lib/saved';
import { specTemplates } from './lib/spec/catalog';
import { buildSpec } from './lib/spec/render';
import type { ColumnsLayout, TemplateSpec } from './lib/spec/types';
import { validateSpec } from './lib/spec/validate';
import { duplicateProblems, fingerprint, indexEntryOf, indexProblems, layoutProblems, metadataProblems, sectionProblems } from './lib/gate';
import { Kit } from './lib/kit';
import type { TemplateCategory } from './lib/types';
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

  it('passes the layout gate: nothing sticks out of its frame, no text lands on other text, and all text fits its box', () => {
    expect(layoutProblems(def.id, def.build(freshId))).toEqual([]);
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

  it('a template link (?template=<id>) fills a new empty board with that template, and following it again after a reload adds no second copy', async () => {
    const Noop = () => null;
    const frameDef = { type: 'frame', Component: Noop, resize: 'free', container: true, rotatable: false, defaults: () => ({}) } as unknown as ElementDefinition<'frame'>;
    const templates: FeatureBundle = { manifest, elements: [], tools: [], formats: [], panels: [], commands: commands as FeatureBundle['commands'] };
    const shapes: FeatureBundle = { manifest: { name: 'shapes', description: '' }, elements: [frameDef], tools: [], formats: [], panels: [], commands: [] };
    const board = createTestBoard({ users: ['ann'], features: [templates, shapes] });
    try {
      const [editor] = board.editors('templates');
      const frameTitles = () => editor.getElements().flatMap((e) => (e.type === 'frame' ? [(e as FrameElement).title] : []));
      editor.runCommand('templates.fromLink', { template: 'retrospective' });
      await vi.waitFor(() => expect(frameTitles()).toEqual(['Retrospective']));
      const count = editor.getElements().length;
      editor.runCommand('templates.fromLink', { template: 'retrospective' });
      await new Promise((r) => setTimeout(r, 0));
      expect(editor.getElements().length).toBe(count);
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
    // Spec templates are found from the index alone, before their content has loaded.
    expect(filterTemplates(TEMPLATES, 'battlecard', null)[0].id).toBe('battlecard');
    expect(filterTemplates(TEMPLATES, 'experiment plan', null)[0].id, 'the name that starts with the query wins the tie').toBe('experiment-plan');
  });
});

describe('spec templates', () => {
  const all: Array<{ file: string; spec: TemplateSpec }> = [];
  beforeAll(async () => {
    for (const [file, load] of Object.entries(SPEC_FILES)) for (const spec of (await load()).default) all.push({ file, spec });
  });

  it('the picker index lists every spec file with its current names and words, so no spec goes missing from search (`npm run templates:index`)', () => {
    const onDisk = readdirSync(new URL('./lib/specs/', import.meta.url)).filter((f) => f.endsWith('.ts') && f !== 'index.ts').map((f) => f.replace(/\.ts$/, ''));
    expect(indexProblems(SPEC_INDEX, Object.keys(SPEC_FILES), all, onDisk)).toEqual([]);
  });

  it('every spec is complete and readable (metadata for the picker, search and site pages, a how-to, guiding prompts, real example notes, known archetype) and no two templates share an id', () => {
    expect(all.flatMap(({ spec }) => validateSpec(spec))).toEqual([]);
    expect(TEMPLATES.flatMap((t) => metadataProblems(t))).toEqual([]);
    const ids = TEMPLATES.map((t) => t.id);
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([]);
  });

  it('example notes stay inside their sections, sections never overlap and none is left empty, however much content a spec has', () => {
    expect(all.flatMap(({ spec }) => sectionProblems(spec.id, buildSpec(spec, freshId)))).toEqual([]);
  });

  it('no two templates are the same template twice (near-identical names, the same layout with the same sections, or a renamed copy)', () => {
    const specs = new Map(all.map(({ spec }) => [spec.id, spec]));
    expect(duplicateProblems(TEMPLATES.map((t) => fingerprint(t, t.build(freshId), specs.get(t.id))))).toEqual([]);
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

// The quality gate on deliberately broken templates: each check must catch its failure and say
// which template and what is wrong (the real catalog passes it above).
describe('the template gate rejects', () => {
  const base: TemplateSpec = {
    id: 'release-look-back',
    name: 'Release look-back',
    description: 'Look back on a release with the people who shipped it and pick one thing to change.',
    categories: ['agile'],
    keywords: ['release', 'review', 'lessons'],
    hint: 'Write alone for five minutes per column, then read them out and vote on one change.',
    archetype: 'columns',
    columns: [
      { title: 'Went to plan', prompt: 'Which parts of the release went the way we hoped?', notes: ['Feature flags made rollback easy'] },
      { title: 'Surprised us', prompt: 'What happened that nobody expected?', notes: ['Support queue doubled on day one'] },
      { title: 'One change', prompt: 'What single change makes the next release calmer?', notes: ['Dry-run the migration a week early'] },
    ],
  };
  const baseColumns = (base as ColumnsLayout).columns;
  const print = (s: TemplateSpec) => fingerprint(s, buildSpec(s, freshId), s);
  /** A frame with whatever `draw` adds, as a hand-coded template would build it. */
  const drawn = (draw: (k: Kit) => void) => {
    const k = new Kit(freshId);
    k.frame('Test', 900, 700);
    draw(k);
    return k.done();
  };

  it.each<[string, Partial<TemplateSpec>, string]>([
    ['a missing description', { description: '' }, 'description is missing'],
    ['no how-to text', { hint: '' }, 'hint is missing'],
    ['too few search keywords', { keywords: ['release'] }, 'keywords must have 3–14 entries'],
    ['an id that is not URL-safe', { id: 'Release look-back!' }, 'must be URL-safe'],
    ['an unknown category', { categories: ['retros' as TemplateCategory] }, 'unknown category "retros"'],
    ['a section without example notes', { columns: [...baseColumns.slice(0, 2), { title: 'One change', prompt: 'What single change makes it calmer?', notes: [] }] } as Partial<TemplateSpec>, 'column 3 notes must have 1–8 entries (has 0)'],
  ])('a spec with %s, naming the template and the field', (_, change, message) => {
    const spec = { ...base, ...change } as TemplateSpec;
    const problems = validateSpec(spec);
    expect(problems.some((p) => p.startsWith(`${spec.id}: `) && p.includes(message)), problems.join('\n')).toBe(true);
  });

  it('a renamed copy of a template, even in another layout', () => {
    const copy = { ...base, id: 'shipping-review', name: 'Shipping review', archetype: 'clusters', clusters: baseColumns } as TemplateSpec;
    expect(duplicateProblems([print(base), print(copy)])).toEqual([expect.stringMatching(/^shipping-review: too close to "release-look-back" \(Release look-back\): \d+% of the same wording/)]);
  });

  it('the same layout with the same sections under new example notes', () => {
    const lookalike = {
      ...base,
      id: 'project-wrap-up',
      name: 'Project wrap-up',
      columns: [
        { title: 'Went to plan', prompt: 'Name the milestones we hit on time.', notes: ['Vendor contract signed in week two'] },
        { title: 'Surprised us', prompt: 'Name the risks nobody had on the list.', notes: ['The office move overlapped go-live'] },
        { title: 'One change', prompt: 'Pick the habit we take into the next project.', notes: ['Weekly risk review with the sponsor'] },
      ],
    } as TemplateSpec;
    expect(duplicateProblems([print(base), print(lookalike)])).toEqual([
      expect.stringContaining('project-wrap-up: too close to "release-look-back" (Release look-back): same columns layout with 100% of the same section words'),
    ]);
  });

  it('a name people could not tell apart from an existing one', () => {
    const other = {
      ...base,
      id: 'look-back-on-a-release',
      name: 'Look-back on a release',
      archetype: 'prompts',
      items: [
        { prompt: 'Which customer noticed the release first, and how?', notes: ['A reseller emailed within an hour'] },
        { prompt: 'Which alert fired that should have stayed quiet?', notes: ['Disk usage on the old cluster'] },
        { prompt: 'Who needs a thank-you note this week?', notes: ['Mira, for the late-night rollback'] },
      ],
    } as TemplateSpec;
    expect(duplicateProblems([print(base), print(other)])).toEqual([
      expect.stringContaining('look-back-on-a-release: too close to "release-look-back" (Release look-back): the names share 100% of their words'),
    ]);
  });

  it('an id that differs from another only in punctuation', () => {
    const other = {
      ...base,
      id: 'release-lookback',
      name: 'Post-launch alarms',
      archetype: 'clusters',
      clusters: [
        { title: 'Alerts', prompt: 'Which alerts fired after the launch?', notes: ['Queue depth on payments'] },
        { title: 'Customers', prompt: 'Who wrote in about the launch?', notes: ['Two schools asked about exports'] },
      ],
    } as TemplateSpec;
    expect(duplicateProblems([print(base), print(other)])).toEqual([expect.stringContaining('release-lookback: too close to "release-look-back" (Release look-back): the ids differ only in punctuation')]);
  });

  it('a note too long to read at the smallest size notes shrink to', () => {
    const b = drawn((k) => k.sticky(40, 40, 'Everything we learned from the launch, '.repeat(6).trim(), 'yellow'));
    expect(layoutProblems('t', b)).toEqual([expect.stringMatching(/^t: sticky "Everything we learned.*" doesn't fit its 160×160 note even at 14px/)]);
  });

  it('a heading in a shape that runs out of the shape', () => {
    const b = drawn((k) => k.shape('chevron', 40, 40, 200, 60, '<b>Stakeholder interviews and synthesis</b><br>Weeks three to six', { fontSize: 18 }));
    expect(layoutProblems('t', b)).toEqual([expect.stringMatching(/^t: shape "Stakeholder interviews.*" overflows its chevron/)]);
  });

  it('a heading whose text wraps down onto the notes under it', () => {
    const b = drawn((k) => {
      k.text(40, 40, 200, '<b>Things we would do again next time</b>', { size: 22, h: 32 });
      k.sticky(40, 84, 'Daily demo', 'yellow');
    });
    expect(layoutProblems('t', b)).toEqual([expect.stringMatching(/^t: text "Things we would do again next time" \(its lines need \d+px, it has room for \d+px\) overlaps sticky "Daily demo"/)]);
  });

  it('a note placed on top of another', () => {
    const b = drawn((k) => {
      k.sticky(40, 40, 'First idea', 'yellow');
      k.sticky(120, 120, 'Second idea', 'yellow');
    });
    expect(layoutProblems('t', b)).toEqual(['t: sticky "First idea" overlaps sticky "Second idea"']);
  });

  it('an item sticking out of its frame', () => {
    const b = drawn((k) => k.sticky(820, 600, 'Parking lot', 'yellow'));
    expect(layoutProblems('t', b)).toEqual(['t: sticky "Parking lot" sticks out of its frame at 820,600']);
  });

  it('a section left without notes, a note outside every section, and sections drawn over each other', () => {
    const empty = drawn((k) => {
      k.panel(40, 40, 400, 300, '#EEEEEE');
      k.text(60, 60, 360, '<b>Ideas</b>', { size: 22, h: 32 });
    });
    expect(sectionProblems('t', empty)).toEqual(['t: section text "Ideas" has no example notes']);
    const stray = drawn((k) => {
      k.panel(40, 40, 400, 300, '#EEEEEE');
      k.sticky(60, 100, 'Inside', 'yellow');
      k.sticky(480, 100, 'Outside', 'yellow');
    });
    expect(sectionProblems('t', stray)).toEqual(['t: sticky "Outside" spills out of its section']);
    const stacked = drawn((k) => {
      k.panel(40, 40, 400, 300, '#EEEEEE');
      k.panel(300, 200, 400, 300, '#EEEEEE');
      k.sticky(60, 60, 'One', 'yellow');
      k.sticky(520, 320, 'Two', 'yellow');
    });
    expect(sectionProblems('t', stacked)).toEqual(['t: two sections overlap at 40,40']);
  });

  it('an index that was not regenerated after specs changed', () => {
    const renamed = { ...base, name: 'Release retrospective' } as TemplateSpec;
    const added = { ...base, id: 'launch-day-review', name: 'Launch day review' } as TemplateSpec;
    expect(indexProblems([indexEntryOf(base, 'agile')], ['agile'], [{ file: 'agile', spec: renamed }, { file: 'agile', spec: added }], ['agile', 'sales'])).toEqual([
      'specs/sales.ts: not in the index, so none of its templates can load: run `npm run templates:index`',
      'release-look-back: the index has an old name: run `npm run templates:index`',
      'launch-day-review: missing from the index, so the picker and search never show it: run `npm run templates:index`',
    ]);
  });
});
