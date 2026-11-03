// @vitest-environment jsdom
// Importing Visio files (#116): hand-made packages written the way the VSDX format lays them out
// (masters, style sheets, groups, containers, glued connectors, pictures, several pages), and
// hostile ones that must be refused quickly.
import { afterEach, expect, it } from 'vitest';
import { richTextToPlain, type BoardElement, type ConnectorElement, type ElementDraft, type FrameElement, type ShapeElement } from '@freero/shared';
import { createTestBoard, type TestBoard } from '@engine';
import manifest from './feature';
import { ImportError } from './lib/common';
import { placeImport } from './lib/insert';
import { parseVsdx } from './lib/vsdx';
import { buildVsdx, cells, geometry, rectGeometry, zipOf, type FixtureSpec } from './lib/vsdxFixture';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

let seq = 0;
const newId = () => `v${++seq}`;
const text = (el: BoardElement | ElementDraft) => richTextToPlain(String((el as { text?: string; label?: string }).text ?? (el as { label?: string }).label ?? ''));
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

const shape = (id: number, c: Record<string, string | number>, body = '', attrs = '') => `<Shape ID="${id}" Type="Shape"${attrs}>${cells(c)}${body}</Shape>`;
const textOf = (t: string) => `<Text><cp IX="0"/>${t}</Text>`;
const box = (x: number, y: number, w: number, h: number, more: Record<string, string | number> = {}) => ({ PinX: x, PinY: y, Width: w, Height: h, LocPinX: w / 2, LocPinY: h / 2, ...more });
const connections = (pts: Array<[number, number]>) => `<Section N="Connection">${pts.map(([x, y], i) => `<Row IX="${i}">${cells({ X: x, Y: y })}</Row>`).join('')}</Section>`;

/**
 * An order flow on page 1: stencil Process and Decision inside a container, a Lucidchart-style
 * rotated block without a master, an ellipse, shapes Freero has no kind for (with and without
 * text), a stencil shape of unknown name whose inherited geometry is a rectangle, a group, a
 * dynamic connector glued to a shape and to a connection point, a line with a loose end, an
 * embedded and a linked picture and a metafile. Page 2 has one shape; page 3 is a background.
 */
const FLOW: FixtureSpec = {
  styles:
    `<StyleSheet ID="0" NameU="No Style">${cells({ LineWeight: 0.0104, LineColor: 0, LinePattern: 1, FillForegnd: 1, FillPattern: 1 })}<Section N="Character"><Row IX="0">${cells({ Color: 0, Size: 0.1667 })}</Row></Section></StyleSheet>` +
    `<StyleSheet ID="3" NameU="Flow" LineStyle="0" FillStyle="0" TextStyle="0">${cells({ FillForegnd: '#FFF2CC' })}</StyleSheet>`,
  masters: [
    { id: '2', name: 'Process', shapes: shape(5, { Width: 1, Height: 0.75 }, rectGeometry(1, 0.75), ' LineStyle="3" FillStyle="3" TextStyle="3"') },
    {
      id: '4',
      name: 'Decision',
      shapes: shape(
        5,
        { Width: 1, Height: 1 },
        geometry([['MoveTo', { X: 0.5, Y: 0 }], ['LineTo', { X: 1, Y: 0.5 }], ['LineTo', { X: 0.5, Y: 1 }], ['LineTo', { X: 0, Y: 0.5 }], ['LineTo', { X: 0.5, Y: 0 }]]) +
          connections([[0.5, 1], [1, 0.5], [0.5, 0], [0, 0.5]]),
        ' LineStyle="3" FillStyle="3" TextStyle="3"',
      ),
    },
    { id: '6', name: 'Dynamic connector', shapes: shape(5, { BeginX: 0, BeginY: 0, EndX: 1, EndY: 0 }, '', ' LineStyle="0"') },
    { id: '8', name: 'Fancy box', shapes: shape(5, { Width: 2, Height: 1 }, rectGeometry(2, 1), ' LineStyle="0" FillStyle="0"') },
  ],
  pages: [
    {
      name: 'Order flow',
      shapes: [
        shape(12, box(3.5, 9, 6, 2), `<Section N="User"><Row N="msvStructureType">${cells({ Value: 'Container' })}</Row></Section>${textOf('Checkout')}`),
        shape(1, box(2, 9, 1.5, 0.75, { FillForegnd: '#DAE8FC' }), `<Section N="Character"><Row IX="0">${cells({ Style: 1 })}</Row></Section>${textOf('Receive order')}`, ' Master="2"'),
        shape(2, box(5, 9, 1.25, 1), textOf('In stock?'), ' Master="4"'),
        shape(3, box(2, 6, 1.5, 0.5, { Angle: Math.PI / 6 }), rectGeometry(1.5, 0.5) + textOf('Rotated'), ' NameU="Block.7"'),
        shape(4, box(4, 6, 1, 0.5), geometry([['Ellipse', { X: 0.5, Y: 0.25, A: 1, B: 0.25, C: 0.5, D: 0.5 }]]), ' NameU="Oval shape"'),
        shape(6, box(6, 6, 1, 1), geometry([['MoveTo', { X: 0, Y: 0 }], ['LineTo', { X: 0.3, Y: 1 }], ['LineTo', { X: 0.6, Y: 0.1 }], ['LineTo', { X: 1, Y: 0.9 }]]), ' NameU="Zigzag"'),
        shape(7, box(2, 4, 1, 0.6), geometry([['MoveTo', { X: 0, Y: 0 }], ['LineTo', { X: 1, Y: 0.2 }], ['LineTo', { X: 0.8, Y: 0.6 }], ['LineTo', { X: 0.1, Y: 0.5 }], ['LineTo', { X: 0, Y: 0 }]]) + textOf('Odd'), ' NameU="Wave"'),
        shape(8, box(4, 4, 1, 0.5), textOf('Plain'), ' Master="8"'),
        `<Shape ID="9" Type="Group">${cells(box(6, 3, 2, 1))}<Shapes>${shape(10, box(0.5, 0.5, 0.8, 0.8), rectGeometry(0.8, 0.8) + textOf('Left'))}${shape(11, box(1.5, 0.5, 0.8, 0.8), rectGeometry(0.8, 0.8) + textOf('Right'))}</Shapes></Shape>`,
        shape(20, { BeginX: 2.75, BeginY: 9, EndX: 4.375, EndY: 9, EndArrow: 13, LinePattern: 2 }, geometry([['MoveTo', { X: 0, Y: 0 }], ['LineTo', { X: 1.625, Y: 0 }]]) + textOf('check'), ' Master="6"'),
        shape(21, { BeginX: 2, BeginY: 5, EndX: 4, EndY: 5, EndArrow: 0 }, '', ' NameU="Line"'),
        `<Shape ID="30" Type="Foreign">${cells(box(6, 1.5, 1, 1))}<ForeignData ForeignType="Bitmap" CompressionType="PNG"><Rel r:id="rIdImg"/></ForeignData></Shape>`,
        `<Shape ID="31" Type="Foreign">${cells(box(7, 1.5, 1, 1))}<ForeignData ForeignType="Bitmap" CompressionType="PNG"><Rel r:id="rIdWeb"/></ForeignData></Shape>`,
        `<Shape ID="32" Type="Foreign">${cells(box(8, 1.5, 1, 1))}<ForeignData ForeignType="EnhMetaFile"><Rel r:id="rIdEmf"/></ForeignData></Shape>`,
      ].join(''),
      connects:
        '<Connect FromSheet="20" FromCell="BeginX" ToSheet="1" ToCell="PinX"/><Connect FromSheet="20" FromCell="EndX" ToSheet="2" ToCell="Connections.X4"/><Connect FromSheet="21" FromCell="BeginX" ToSheet="3" ToCell="PinX"/>',
      rels: [
        { id: 'rIdImg', target: '../media/image1.png' },
        { id: 'rIdWeb', target: 'https://example.com/tracker.png', external: true },
        { id: 'rIdEmf', target: '../media/image2.emf' },
      ],
    },
    { name: 'Notes', shapes: shape(1, box(2, 9, 1, 0.75), textOf('Second page'), ' Master="2"') },
    { name: 'Letterhead', background: true, shapes: shape(1, box(1, 1, 1, 1), rectGeometry(1, 1)) },
  ],
  media: { 'visio/media/image1.png': PNG, 'visio/media/image2.emf': new Uint8Array([1, 0, 0, 0, 0x6c, 0, 0, 0]) },
};

it('a Visio flowchart lands with connectors glued to the right shapes and connection points, stencils as Freero shapes, containers and pages as frames — and one undo takes it all back', async () => {
  const result = await parseVsdx(await buildVsdx(FLOW), newId);
  const d = result.drafts;
  const byText = (t: string) => d.find((x) => text(x) === t || (x.type === 'frame' && x.title === t))!;
  const kind = (t: string) => (byText(t) as ShapeElement).shape;

  // Every page is a frame of its own, side by side; the background page is left out.
  const [flow, notes] = [byText('Order flow') as FrameElement & ElementDraft, byText('Notes') as FrameElement & ElementDraft];
  expect(d.filter((x) => x.type === 'frame').map((x) => (x as FrameElement).title)).toEqual(expect.arrayContaining(['Order flow', 'Notes', 'Checkout']));
  expect(notes.x).toBeGreaterThan(flow.x + flow.w);
  expect(byText('Second page').frameId).toBe(notes.id);

  // Stencils and recognised geometry → Freero kinds; colours inherited through the master's style sheet.
  expect([kind('Receive order'), kind('In stock?'), kind('Rotated'), kind('Plain'), kind('Odd')]).toEqual(['rect', 'diamond', 'rect', 'rect', 'rect']);
  expect((byText('In stock?') as ShapeElement).fill).toBe('#FFF2CC');
  expect((byText('Receive order') as ShapeElement).fill).toBe('#DAE8FC');
  expect(String((byText('Receive order') as ShapeElement).text)).toContain('<b>');
  expect(d.some((x) => x.type === 'shape' && (x as ShapeElement).shape === 'ellipse')).toBe(true);
  const rotated = byText('Rotated');
  expect([rotated.rotation, rotated.w, rotated.h]).toEqual([330, 144, 48]); // 30° counter-clockwise, 1.5 × 0.5 in
  expect(d.filter((x) => x.type === 'pen')).toHaveLength(1); // the zigzag's outline

  // The container is a frame holding the shapes drawn inside it, itself inside the page's frame.
  const checkout = byText('Checkout');
  expect([byText('Receive order').frameId, byText('In stock?').frameId, checkout.frameId]).toEqual([checkout.id, checkout.id, flow.id]);

  // A group stays one group.
  expect(byText('Left').groupId).toBeTruthy();
  expect(byText('Left').groupId).toBe(byText('Right').groupId);

  // The dynamic connector: glued to the whole Process shape and to the Decision's left point.
  const lines = d.filter((x): x is ConnectorElement & ElementDraft => x.type === 'connector');
  const check = lines.find((l) => text(l) === 'check')!;
  expect([check.start.elementId, check.start.anchor, check.end.elementId, check.end.at]).toEqual([byText('Receive order').id, 'auto', byText('In stock?').id, { u: 0, v: 0.5 }]);
  expect([check.routing, check.endCap, check.strokeStyle, check.frameId]).toEqual(['elbow', 'triangle', 'dashed', checkout.id]);
  const loose = lines.find((l) => l !== check)!;
  expect([loose.start.elementId, loose.end.elementId ?? null, loose.endCap]).toEqual([rotated.id, null, 'none']);

  // Pictures: the embedded one is stored; a linked one is never fetched; a metafile is reported.
  expect(result.images.map((i) => i.source.slice(0, 22))).toEqual(['data:image/png;base64,']);
  expect(result.report.skipped).toEqual(
    expect.arrayContaining([
      { what: 'Background pages (left out)', count: 1 },
      { what: '“Zigzag” shapes (drawn as outlines)', count: 1 },
      { what: '“Wave” shapes (drawn as rectangles)', count: 1 },
      { what: 'Linked pictures (left out)', count: 1 },
      { what: 'Pictures in formats Freero doesn’t show (left out)', count: 1 },
    ]),
  );
  expect(result.report.skipped).toHaveLength(5); // the stencil with an unknown name but a rectangle's geometry isn't one

  board = createTestBoard({ users: ['ann'], features: [manifest] });
  const [ed] = board.editors('import');
  ed.createMany([{ type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: 'yellow', text: 'Already here', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle' }] as never);
  await placeImport(ed, result, { x: 0, y: 0 });
  const placed = ed.getElements();
  const placedCheck = placed.find((e): e is ConnectorElement => e.type === 'connector' && text(e) === 'check')!;
  expect([placedCheck.start.elementId, placedCheck.end.elementId]).toEqual([placed.find((e) => text(e) === 'Receive order')!.id, placed.find((e) => text(e) === 'In stock?')!.id]);
  ed.undo();
  expect(ed.getElements().map((e) => text(e))).toEqual(['Already here']);
});

it('hostile or broken .vsdx files are refused quickly with a reason, never with a crash: zip bombs, too many parts, DTDs, old binary files, timeouts and random corruption', async () => {
  const good = await buildVsdx(FLOW);
  const refuse = async (bytes: Uint8Array, why: RegExp, opts?: { timeLimitMs?: number }) => {
    const err = await parseVsdx(bytes, newId, opts).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ImportError);
    expect((err as Error).message).toMatch(why);
  };
  // 40 MB of one byte, a few KB deflated: stopped at the cap, whatever size the header claims.
  await refuse(await zipOf([['visio/document.xml', new Uint8Array(40 * 1024 * 1024).fill(0x41)]]), /unpacks to more/);
  await refuse(await zipOf(Array.from({ length: 2001 }, (_, i) => [`x/${i}`, ''] as [string, string]), { store: true }), /parts/);
  const onePage = await buildVsdx({ pages: [{ name: 'P', shapes: '' }] });
  const dtd = await zipOf([
    ['_rels/.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r" Type="x/document" Target="visio/document.xml"/></Relationships>'],
    ['visio/document.xml', '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><VisioDocument>&b;</VisioDocument>'],
  ]);
  await refuse(dtd, /DOCTYPE/);
  await refuse(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]), /\.vsd\b/);
  await refuse(new TextEncoder().encode('<html>not a drawing</html>'), /ZIP/);
  await refuse(onePage, /too long/, { timeLimitMs: -1 });

  // Random damage anywhere in a real package: every outcome is a drawing or an ImportError, fast.
  let state = 42;
  const rand = (n: number) => {
    state = (state * 1103515245 + 12345) % 2 ** 31;
    return state % n;
  };
  const started = Date.now();
  for (let i = 0; i < 150; i++) {
    const bytes = good.slice(0, i % 10 === 0 ? rand(good.length) : good.length);
    for (let k = 0; k < 1 + rand(8); k++) bytes[rand(bytes.length)] = rand(256);
    const outcome = await parseVsdx(bytes, newId).then(
      (r) => r,
      (e: unknown) => e,
    );
    if (!(outcome instanceof ImportError)) expect(Array.isArray((outcome as { drafts?: unknown }).drafts), `case ${i}: ${String(outcome)}`).toBe(true);
  }
  expect(Date.now() - started).toBeLessThan(15_000);
});
