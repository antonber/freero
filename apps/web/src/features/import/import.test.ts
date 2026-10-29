// @vitest-environment jsdom
// Importing draw.io and Excalidraw files (KAI-138): what lands on a real engine board (createTestBoard),
// from files written the way those apps write them.
import { deflateRawSync } from 'node:zlib';
import { afterEach, expect, it } from 'vitest';
import { richTextToPlain, type BoardElement, type ConnectorElement, type ElementDraft, type PenElement, type ShapeElement } from '@freero/shared';
import { createTestBoard, type TestBoard } from '@engine';
import manifest from './feature';
import { ImportError } from './lib/common';
import { inflatePage, parseDrawio } from './lib/drawio';
import { parseExcalidraw } from './lib/excalidraw';
import { importFile, placeImport } from './lib/insert';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

let seq = 0;
const newId = () => `id${++seq}`;
const text = (el: BoardElement | ElementDraft) => richTextToPlain(String((el as { text?: string; label?: string }).text ?? (el as { label?: string }).label ?? ''));

// A flowchart as draw.io saves it: a swimlane holding two steps, a decision, a group of two
// notes, free text, labelled edges (one label as an edge-label cell), an edge with a loose end,
// and a shape draw.io has that Freero doesn't.
const MODEL = `<mxGraphModel><root>
  <mxCell id="0"/><mxCell id="1" parent="0"/>
  <mxCell id="lane" value="Checkout" style="swimlane;startSize=30;" vertex="1" parent="1"><mxGeometry x="0" y="0" width="400" height="300" as="geometry"/></mxCell>
  <mxCell id="a" value="Add to &lt;b&gt;cart&lt;/b&gt;" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#dae8fc;" vertex="1" parent="lane"><mxGeometry x="40" y="60" width="120" height="60" as="geometry"/></mxCell>
  <mxCell id="b" value="Pay" style="ellipse;whiteSpace=wrap;html=1;" vertex="1" parent="lane"><mxGeometry x="240" y="60" width="120" height="60" as="geometry"/></mxCell>
  <mxCell id="c" value="In stock?" style="rhombus;whiteSpace=wrap;html=1;" vertex="1" parent="1"><mxGeometry x="500" y="60" width="100" height="100" as="geometry"/></mxCell>
  <mxCell id="g" value="" style="group" vertex="1" connectable="0" parent="1"><mxGeometry x="700" y="0" width="200" height="100" as="geometry"/></mxCell>
  <mxCell id="n1" value="Note 1" style="shape=note;whiteSpace=wrap;" vertex="1" parent="g"><mxGeometry x="0" y="0" width="80" height="80" as="geometry"/></mxCell>
  <mxCell id="n2" value="Note 2" style="shape=note;whiteSpace=wrap;" vertex="1" parent="g"><mxGeometry x="100" y="0" width="80" height="80" as="geometry"/></mxCell>
  <mxCell id="t" value="Happy path" style="text;html=1;" vertex="1" parent="1"><mxGeometry x="0" y="320" width="100" height="20" as="geometry"/></mxCell>
  <mxCell id="odd" value="Pump" style="shape=mxgraph.pid.pumps.centrifugal_pump_1;" vertex="1" parent="1"><mxGeometry x="500" y="300" width="60" height="60" as="geometry"/></mxCell>
  <mxCell id="e1" value="next" style="edgeStyle=orthogonalEdgeStyle;" edge="1" parent="1" source="a" target="b"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e2" style="exitX=1;exitY=0.5;entryX=0;entryY=0.5;dashed=1;endArrow=block;endFill=0;" edge="1" parent="1" source="b" target="c"><mxGeometry relative="1" as="geometry"/></mxCell>
  <mxCell id="e2l" value="if paid" style="edgeLabel;html=1;" vertex="1" connectable="0" parent="e2"><mxGeometry x="-0.2" relative="1" as="geometry"/></mxCell>
  <mxCell id="e3" style="endArrow=none;" edge="1" parent="1" source="c"><mxGeometry relative="1" as="geometry"><mxPoint x="650" y="250" as="targetPoint"/></mxGeometry></mxCell>
</root></mxGraphModel>`;

const compressed = (xml: string) => `<mxfile host="test"><diagram id="p1" name="Flow">${deflateRawSync(Buffer.from(encodeURIComponent(xml))).toString('base64')}</diagram></mxfile>`;

it('a compressed draw.io flowchart lands with lines attached to the right shapes, labels intact, a swimlane as a frame holding its steps — and one undo takes it all back', async () => {
  const result = await parseDrawio(compressed(MODEL), newId);
  const byText = (t: string) => result.drafts.find((d) => text(d) === t || (d.type === 'frame' && d.title === t))!;
  const [lane, add, pay, stock] = [byText('Checkout'), byText('Add to cart'), byText('Pay'), byText('In stock?')];
  expect([lane.type, (add as ShapeElement).shape, (pay as ShapeElement).shape, (stock as ShapeElement).shape]).toEqual(['frame', 'roundRect', 'ellipse', 'diamond']);
  // Children of the swimlane: inside its frame, at absolute positions.
  expect([add.frameId, pay.frameId, add.x, add.y]).toEqual([lane.id, lane.id, 40, 60]);
  expect(text(add)).toBe('Add to cart'); // an HTML label reads as its text, never as markup

  const lines = result.drafts.filter((d): d is ConnectorElement => d.type === 'connector');
  const next = lines.find((l) => text(l) === 'next')!;
  expect([next.start.elementId, next.end.elementId, next.routing]).toEqual([add.id, pay.id, 'elbow']);
  const paid = lines.find((l) => text(l) === 'if paid')!; // the edge-label cell folded into its line
  expect([paid.start.elementId, paid.end.elementId, paid.strokeStyle, paid.endCap]).toEqual([pay.id, stock.id, 'dashed', 'triangleOpen']);
  expect([paid.start.at, paid.end.at]).toEqual([{ u: 1, v: 0.5 }, { u: 0, v: 0.5 }]);
  const loose = lines.find((l) => l.endCap === 'none')!;
  expect([loose.start.elementId, loose.end.elementId ?? null, loose.end.x, loose.end.y]).toEqual([stock.id, null, 650, 250]);

  const notes = result.drafts.filter((d) => d.type === 'shape' && (d as ShapeElement).shape === 'umlNote');
  expect(notes).toHaveLength(2);
  expect(notes[0].groupId).toBeTruthy();
  expect(notes[0].groupId).toBe(notes[1].groupId);
  expect(notes.map((n) => n.x)).toEqual([700, 800]); // positions relative to the group, made absolute
  expect(result.drafts.find((d) => d.type === 'text' && text(d) === 'Happy path')).toBeTruthy();
  expect(result.report.skipped).toEqual([{ what: '“pid.pumps.centrifugal_pump_1” shapes (drawn as rectangles)', count: 1 }]);

  board = createTestBoard({ users: ['ann'], features: [manifest] });
  const [ed] = board.editors('import');
  ed.createMany([{ type: 'sticky', x: 0, y: 0, w: 200, h: 200, color: 'yellow', text: 'Already here', fontFamily: 'sans', fontSize: 'auto', textColor: '#000', align: 'center', vAlign: 'middle' }] as never);
  const report = await placeImport(ed, result, { x: 0, y: 0 });
  expect(report.imported).toBe(result.drafts.length);
  const onBoard = ed.getElements();
  const placedNext = onBoard.find((e): e is ConnectorElement => e.type === 'connector' && text(e) === 'next')!;
  const placedAdd = onBoard.find((e) => e.type === 'shape' && text(e) === 'Add to cart')!;
  const placedPay = onBoard.find((e) => e.type === 'shape' && text(e) === 'Pay')!;
  expect([placedNext.start.elementId, placedNext.end.elementId]).toEqual([placedAdd.id, placedPay.id]); // still attached after placing
  ed.undo();
  expect(ed.getElements().map((e) => text(e))).toEqual(['Already here']);
});

it('untrusted draw.io input is refused before it can hurt: DTDs (entity expansion, external entities) and pages that unpack past the cap', async () => {
  const billion = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><mxGraphModel><root><mxCell id="0" value="&lol2;"/></root></mxGraphModel>`;
  await expect(parseDrawio(billion, newId)).rejects.toThrow(/DOCTYPE/);
  const bomb = deflateRawSync(Buffer.alloc(8 * 1024 * 1024, 0x41)).toString('base64'); // ~8 KB that unpacks to 8 MB
  await expect(inflatePage(bomb, 1024 * 1024)).rejects.toThrow(/unpacks to more/);
  await expect(parseDrawio('<mxfile><diagram>not base64 at all!!</diagram></mxfile>', newId)).rejects.toBeInstanceOf(ImportError);
});

// An Excalidraw scene: two rectangles with text bound inside, an arrow bound to both with a label,
// freehand ink, a frame holding one rectangle, a group, a deleted item and an embed.
const SCENE = {
  type: 'excalidraw',
  version: 2,
  source: 'https://excalidraw.com',
  elements: [
    { id: 'f', type: 'frame', x: -50, y: -50, width: 400, height: 300, name: 'Sprint', angle: 0 },
    { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 160, height: 80, angle: 0, strokeColor: '#1e1e1e', backgroundColor: '#a5d8ff', strokeStyle: 'solid', strokeWidth: 2, roundness: { type: 3 }, frameId: 'f', groupIds: ['inner', 'outer'], boundElements: [{ id: 't1', type: 'text' }] },
    { id: 't1', type: 'text', x: 10, y: 20, width: 100, height: 25, text: 'Design', originalText: 'Design', fontSize: 20, fontFamily: 1, containerId: 'r1', textAlign: 'center' },
    { id: 'r2', type: 'ellipse', x: 500, y: 0, width: 160, height: 80, angle: 0, strokeColor: '#e03131', backgroundColor: 'transparent', strokeStyle: 'dashed', groupIds: ['outer'] },
    { id: 'a1', type: 'arrow', x: 160, y: 40, width: 340, height: 0, points: [[0, 0], [340, 0]], startBinding: { elementId: 'r1', focus: 0, gap: 4 }, endBinding: { elementId: 'r2', focus: 0, gap: 4 }, startArrowhead: null, endArrowhead: 'triangle', strokeColor: '#1e1e1e' },
    { id: 'at', type: 'text', x: 300, y: 30, width: 40, height: 20, text: 'then', containerId: 'a1' },
    { id: 'p1', type: 'freedraw', x: 0, y: 200, width: 50, height: 20, points: [[0, 0], [10, 5], [30, 20], [50, 10]], pressures: [0.2, 0.4, 0.6, 0.8], simulatePressure: false, strokeColor: '#2f9e44', strokeWidth: 2 },
    { id: 'gone', type: 'rectangle', x: 0, y: 0, width: 10, height: 10, isDeleted: true },
    { id: 'web', type: 'embeddable', x: 900, y: 0, width: 300, height: 200, link: 'https://example.com' },
  ],
  appState: {},
  files: {},
};

it('an Excalidraw scene lands with arrows attached to the shapes they are bound to, bound text as labels, freehand as pen strokes and one group', () => {
  const result = parseExcalidraw(JSON.stringify(SCENE), newId);
  const shapes = result.drafts.filter((d): d is ShapeElement & ElementDraft => d.type === 'shape');
  const design = shapes.find((s) => text(s) === 'Design')!;
  const ellipse = shapes.find((s) => s.shape === 'ellipse')!;
  const frame = result.drafts.find((d) => d.type === 'frame')!;
  expect([design.shape, design.fontFamily, design.frameId, ellipse.strokeStyle, ellipse.fillOpacity]).toEqual(['roundRect', 'hand', frame.id, 'dashed', 0]);
  expect(design.groupId).toBeTruthy();
  expect(design.groupId).toBe(ellipse.groupId); // the outermost group: they move together
  const arrow = result.drafts.find((d): d is ConnectorElement & ElementDraft => d.type === 'connector')!;
  expect([arrow.start.elementId, arrow.end.elementId, arrow.startCap, arrow.endCap, text(arrow)]).toEqual([design.id, ellipse.id, 'none', 'triangle', 'then']);
  const ink = result.drafts.find((d): d is PenElement & ElementDraft => d.type === 'pen')!;
  expect([ink.x, ink.y, ink.points.length / 3, ink.points[2], ink.stroke]).toEqual([0, 200, 4, 0.2, '#2F9E44']);
  expect(result.drafts.some((d) => d.type === 'text')).toBe(false); // bound text never becomes a stray text box
  expect(result.drafts).toHaveLength(5); // frame, 2 shapes, arrow, ink — not the deleted one
  expect(result.report.skipped).toEqual([{ what: 'Embedded web pages (left out)', count: 1 }]);
});

it('a malformed file adds nothing to the board and says why', async () => {
  board = createTestBoard({ users: ['ann'], features: [manifest] });
  const [ed] = board.editors('import');
  for (const [name, body] of [
    ['broken.excalidraw', '{"type":"excalidraw","elements":[{'],
    ['broken.drawio', '<mxfile><diagram><mxGraphModel><root><mxCell id="0"'],
    ['notes.drawio', '<html><body>not a diagram</body></html>'],
  ]) {
    await expect(importFile(ed, new File([body], name))).rejects.toBeInstanceOf(ImportError);
  }
  expect(ed.getElements()).toEqual([]);
  expect(ed.canUndo()).toBe(false);
});
