// @vitest-environment jsdom
// Importing PowerPoint decks (#136): a hand-made deck written the way the Office Open XML format
// lays it out (a master with a theme and artwork, a layout, placeholders that inherit their place,
// text boxes, shapes, a glued line, pictures, a table, a chart, speaker notes, a hidden slide, a
// deck order that differs from the part names), and hostile files that must be refused quickly.
import { afterEach, expect, it } from 'vitest';
import { richTextToPlain, type BoardElement, type ConnectorElement, type ElementDraft, type FrameElement, type ImageElement, type ShapeElement, type TableElement, type TextElement } from '@freero/shared';
import { createTestBoard, defineCommands, type FeatureBundle, type TestBoard } from '@engine';
import manifest from './feature';
import { ImportError } from './lib/common';
import { placeImport } from './lib/insert';
import { parsePptx } from './lib/pptx';
import { buildPptx, chart, cxn, para, pic, pngOf, sp, table, type PptxSpec } from './lib/pptxFixture';
import { zipOf } from './lib/vsdxFixture';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

let seq = 0;
const newId = () => `p${++seq}`;
const plain = (el: BoardElement | ElementDraft) => richTextToPlain(String((el as { text?: string }).text ?? ''));

async function deck(): Promise<PptxSpec> {
  return {
    // Parts: slide1 "Numbers", slide2 "Welcome", slide3 hidden — the deck plays 2, 1, 3.
    order: [2, 1, 3],
    layoutShapes: sp(2, { ph: { type: 'ctrTitle' }, box: { x: 100, y: 250, w: 1080, h: 140 } }),
    masterShapes: sp(20, { box: { x: 1180, y: 660, w: 80, h: 40 }, geom: 'roundRect', fill: '2F7D6D', line: '2F7D6D', paras: para(['F']) }),
    media: { 'ppt/media/image1.png': await pngOf(4, 2, [200, 40, 40]) },
    slides: [
      {
        shapes:
          sp(2, { ph: { type: 'title' }, paras: para(['Numbers']) }) +
          sp(3, { ph: { type: 'body', idx: 1 }, box: { x: 64, y: 180, w: 500, h: 300 }, paras: para(['Revenue grew']) + para(['Costs fell']) }) +
          sp(4, { textBox: true, box: { x: 640, y: 180, w: 400, h: 60 }, paras: para(['Revenue ', ['up', 'b="1"', 'C0392B']]) }) +
          sp(10, { box: { x: 640, y: 300, w: 160, h: 80 }, geom: 'rect', fill: 'FFFFFF', line: '333333', paras: para(['Plan']) }) +
          sp(11, { box: { x: 900, y: 300, w: 160, h: 80 }, geom: 'ellipse', style: true, paras: para(['Ship']) }) +
          cxn(12, { x: 800, y: 340 }, { x: 900, y: 340 }, { start: 10, end: 11 }) +
          pic(13, 'rIdP1', { x: 64, y: 500, w: 200, h: 100 }, { crop: { l: 0.25, t: 0, r: 0.25, b: 0 }, descr: 'Red bar' }) +
          pic(14, 'rIdLink', { x: 300, y: 500, w: 100, h: 100 }, { link: true }) +
          table(15, { x: 640, y: 420, w: 400, h: 120 }, [['Quarter', 'Total'], ['Q3', '42']], { '1:1': 'FFF2CC' }) +
          chart(16, 'rIdC', { x: 1060, y: 420, w: 180, h: 120 }),
        rels: [
          { id: 'rIdP1', type: 'image', target: '../media/image1.png' },
          { id: 'rIdLink', type: 'image', target: 'https://example.com/never.png', external: true },
          { id: 'rIdC', type: 'chart', target: '../charts/chart1.xml' },
        ],
        notes: 'Point at the chart',
      },
      {
        shapes: sp(2, { ph: { type: 'ctrTitle' }, paras: para(['Welcome']) }) + sp(3, { ph: { type: 'subTitle', idx: 1 }, box: { x: 100, y: 420, w: 1080, h: 60 }, paras: para(['Q3 review']) }),
        notes: 'Welcome everyone\nThen the numbers',
        background: '<p:bgPr><a:solidFill><a:srgbClr val="F5F0E6"/></a:solidFill></p:bgPr>',
      },
      { shapes: sp(2, { textBox: true, box: { x: 100, y: 100, w: 300, h: 60 }, paras: para(['Backup']) }), hidden: true },
    ],
  };
}

it('a PowerPoint deck lands as its slides in the deck’s order — text, shapes, a glued line, pictures, a table, notes as presenter notes — and one undo takes it all back', async () => {
  const result = await parsePptx(await buildPptx(await deck()), newId);
  const d = result.drafts;
  const frames = d.filter((x): x is FrameElement & ElementDraft => x.type === 'frame');
  // The deck's order (not the part names'), side by side; the hidden slide is skipped when presenting.
  expect(frames.map((f) => f.title)).toEqual(['Welcome', 'Numbers', 'Slide 3']);
  expect(frames.map((f) => f.index)).toEqual([0, 1, 2]);
  expect(frames[1].x).toBeGreaterThan(frames[0].x + frames[0].w);
  expect(frames.map((f) => !!f.skip)).toEqual([false, false, true]);
  expect([frames[0].w, frames[0].h, frames[0].preset, frames[0].fill]).toEqual([1280, 720, '16:9', '#F5F0E6']);
  const [welcome, numbers] = frames;
  const on = (f: FrameElement) => d.filter((x) => x.frameId === f.id);
  const find = (f: FrameElement, t: string) => on(f).find((x) => plain(x) === t)!;

  // A placeholder without its own place takes its layout's; titles take the master's style.
  const title = find(welcome, 'Welcome') as TextElement & ElementDraft;
  expect([title.type, title.x - welcome.x, title.y, title.w, title.h]).toEqual(['text', 100, 250, 1080, 140]);
  expect(title.text).toContain('<b>');
  expect(title.fontFamily).toBe('serif'); // the theme's heading face (Georgia)
  expect(find(numbers, 'Numbers').y).toBe(32); // from the master
  // Body placeholders are bulleted; a run's own colour and weight are kept.
  expect((find(numbers, 'Revenue grew\nCosts fell') as TextElement).text).toMatch(/^<ul><li>Revenue grew<\/li><li>Costs fell<\/li><\/ul>$/);
  const runs = find(numbers, 'Revenue up') as TextElement;
  expect(runs.text).toContain('<b>up</b>');
  expect(runs.text).toContain('#C0392B');

  // Shapes: a theme-styled ellipse in the theme's accent, a glued connector between two shapes.
  const ship = find(numbers, 'Ship') as ShapeElement & ElementDraft;
  expect([ship.type, ship.shape, ship.fill]).toEqual(['shape', 'ellipse', '#2F7D6D']);
  const plan = find(numbers, 'Plan');
  const line = on(numbers).find((x): x is ConnectorElement & ElementDraft => x.type === 'connector')!;
  expect([line.start.elementId, line.end.elementId, line.endCap]).toEqual([plan.id, ship.id, 'arrow']);

  // Pictures: embedded and cropped as on the slide; a linked one is never fetched.
  const img = on(numbers).find((x): x is ImageElement & ElementDraft => x.type === 'image')!;
  expect([img.alt, img.crop, img.w, img.naturalW]).toEqual(['Red bar', { x: 0.25, y: 0, w: 0.5, h: 1 }, 200, 400]);
  expect(result.images.map((i) => [i.id, i.source.slice(0, 22)])).toEqual([[img.id, 'data:image/png;base64,']]);

  // A table with its cells (and a cell's fill); the chart becomes a labelled box, reported.
  const tbl = on(numbers).find((x): x is TableElement & ElementDraft => x.type === 'table')!;
  expect([tbl.rows.length, tbl.cols.length, tbl.header]).toEqual([2, 2, true]);
  const cells = result.content![tbl.id];
  expect(richTextToPlain(cells[`${tbl.rows[1].id}:${tbl.cols[0].id}`].t!)).toBe('Q3');
  expect(cells[`${tbl.rows[1].id}:${tbl.cols[1].id}`].f).toBe('#FFF2CC');
  expect(plain(on(numbers).find((x) => plain(x).startsWith('Chart'))!)).toBe('Chart (not imported)');

  // The master's artwork is on every slide.
  expect(frames.map((f) => on(f).filter((x) => plain(x) === 'F').length)).toEqual([1, 1, 1]);
  expect(result.report.skipped).toEqual(
    expect.arrayContaining([
      { what: 'Charts (placed as a labelled box)', count: 1 },
      { what: 'Linked pictures (left out)', count: 1 },
    ]),
  );

  // On a board: notes go to the presenter notes of the right slides, after the board's own slides.
  const present: FeatureBundle = {
    manifest: { name: 'present', description: '', owns: ['presenterNotes'] },
    elements: [],
    tools: [],
    formats: [],
    panels: [],
    commands: defineCommands([
      { id: 'present.setNote', label: 'Set note', run: (ed, a) => ed.collection<{ text: string }>('presenterNotes').set(String(a?.frameId), { text: String(a?.text) }) },
    ]),
  };
  board = createTestBoard({ users: ['ann'], features: [manifest, present] });
  const [ed] = board.editors('import');
  ed.create({ type: 'frame', x: 0, y: 0, w: 400, h: 300, title: 'Mine', fill: '#fff', index: 4 } as never);
  await placeImport(ed, result, { x: 0, y: 0 });
  const placed = ed.getElements().filter((e): e is FrameElement => e.type === 'frame');
  const byTitle = (t: string) => placed.find((f) => f.title === t)!;
  expect([byTitle('Welcome').index, byTitle('Numbers').index, byTitle('Slide 3').index]).toEqual([5, 6, 7]);
  const notes = ed.collection<{ text: string }>('presenterNotes');
  expect([notes.get(byTitle('Welcome').id)?.text, notes.get(byTitle('Numbers').id)?.text]).toEqual(['Welcome everyone\nThen the numbers', 'Point at the chart']);
  ed.undo();
  expect(ed.getElements().map((e) => (e as FrameElement).title)).toEqual(['Mine']);
  // Notes stay with the slides' ids (never shown without them), so a redo brings both back.
  ed.redo();
  expect(ed.getElement(byTitle('Welcome').id)).toBeDefined();
  expect(notes.get(byTitle('Welcome').id)?.text).toBe('Welcome everyone\nThen the numbers');
});

it('hostile or broken .pptx files are refused quickly with a reason, never with a crash: zip bombs, too many parts or slides, DTDs, old binary decks, timeouts and random corruption', async () => {
  const good = await buildPptx(await deck());
  const refuse = async (bytes: Uint8Array, why: RegExp, opts?: { timeLimitMs?: number }) => {
    const err = await parsePptx(bytes, newId, opts).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ImportError);
    expect((err as Error).message).toMatch(why);
  };
  // 40 MB of one byte, a few KB deflated: stopped at the cap, whatever size the header claims.
  await refuse(await zipOf([['ppt/presentation.xml', new Uint8Array(40 * 1024 * 1024).fill(0x41)]]), /unpacks to more/);
  await refuse(await zipOf(Array.from({ length: 2001 }, (_, i) => [`x/${i}`, ''] as [string, string]), { store: true }), /parts/);
  await refuse(await buildPptx({ slides: Array.from({ length: 301 }, () => ({ shapes: '' })) }), /301 slides/);
  const dtd = await zipOf([
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="x/officeDocument" Target="ppt/presentation.xml"/></Relationships>'],
    ['ppt/presentation.xml', '<?xml version="1.0"?><!DOCTYPE p [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><presentation>&b;</presentation>'],
  ]);
  await refuse(dtd, /DOCTYPE/);
  await refuse(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), /\.ppt\b/);
  await refuse(new TextEncoder().encode('<html>not a deck</html>'), /ZIP/);
  await refuse(await zipOf([['word/document.xml', '<document/>']]), /isn’t a PowerPoint deck/);
  await refuse(good, /too long/, { timeLimitMs: -1 });

  // Random damage anywhere in a real deck: every outcome is a deck or an ImportError, fast.
  let state = 7;
  const rand = (n: number) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state % n;
  };
  const started = Date.now();
  for (let i = 0; i < 150; i++) {
    const bytes = good.slice(0, i % 10 === 0 ? rand(good.length) : good.length);
    for (let k = 0; k < 1 + rand(8); k++) bytes[rand(bytes.length)] = rand(256);
    const outcome = await parsePptx(bytes, newId).then(
      (r) => r,
      (e: unknown) => e,
    );
    if (!(outcome instanceof ImportError)) expect(Array.isArray((outcome as { drafts?: unknown }).drafts), `case ${i}: ${String(outcome)}`).toBe(true);
  }
  expect(Date.now() - started).toBeLessThan(15_000);
});
