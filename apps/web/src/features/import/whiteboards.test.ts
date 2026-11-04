// @vitest-environment jsdom
// Boards from other whiteboards (#62 Miro through its API, #163 Mural's CSV, #165 Lucid's CSV):
// what lands on a real engine board, from data shaped the way each tool writes it.
import { afterEach, expect, it } from 'vitest';
import { richTextToPlain, type BoardElement, type ConnectorElement, type ElementDraft, type MiroImportResponse, type MiroItem } from '@freero/shared';
import { createTestBoard, type TestBoard } from '@engine';
import manifest from './feature';
import { parseLucid } from './lib/lucid';
import { parseMiro } from './lib/miro';
import { parseMural } from './lib/mural';
import { kindOfFile, placeImport } from './lib/insert';

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
});

let seq = 0;
const newId = () => `id${++seq}`;
const text = (el: BoardElement | ElementDraft) => richTextToPlain(String((el as { text?: string }).text ?? (el as { title?: string }).title ?? (el as { label?: string }).label ?? ''));
const inside = (el: ElementDraft, f: ElementDraft) => el.x >= f.x && el.y >= f.y && el.x + el.w <= f.x + f.w && el.y + el.h <= f.y + f.h;
const overlap = (a: ElementDraft, b: ElementDraft) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const item = (o: Partial<MiroItem> & Pick<MiroItem, 'id' | 'type'>): MiroItem => ({ x: 0, y: 0, w: null, h: null, rotation: 0, parentId: null, content: '', ...o });

// A retro as Miro's API describes it: a frame (centre 0,0) holding two stickies placed from its
// top left, one of them written to hurt; two shapes joined by a connector; a tag named to hurt.
const MIRO: MiroImportResponse = {
  board: { name: 'Retro' },
  items: [
    item({ id: 'f', type: 'frame', w: 1200, h: 800, content: 'Sprint 12' }),
    item({ id: 's1', type: 'sticky_note', parentId: 'f', x: 200, y: 200, w: 200, h: 228, content: '<p>Went well: <strong>pairing</strong></p>', fill: 'light_yellow', tagIds: ['t1'] }),
    item({ id: 's2', type: 'sticky_note', parentId: 'f', x: 500, y: 200, w: 300, shape: 'rectangle', content: '<img src=x onerror="alert(1)"><script>alert(2)</script>Ship it &amp; <b>tell</b> everyone', fill: 'light_pink' }),
    item({ id: 'a', type: 'shape', x: 900, y: -300, w: 240, h: 120, shape: 'round_rectangle', content: '<p>Plan</p>' }),
    item({ id: 'b', type: 'shape', x: 900, y: 0, w: 200, h: 160, shape: 'rhombus', content: '<p>Ship?</p>' }),
    item({ id: 'm', type: 'mindmap_node', x: 0, y: 900, w: 100, h: 40 }),
  ],
  connectors: [
    { id: 'c1', from: 'a', to: 'b', fromAt: { u: 0.5, v: 1 }, toAt: { u: 0.5, v: 0 }, shape: 'elbowed', caption: '<p>then</p>', style: 'dashed', endCap: 'stealth' },
    { id: 'c2', from: 'b', to: 'm', shape: 'straight', caption: '' },
  ],
  tags: [{ id: 't1', title: 'Keep <script>x</script>', color: 'green' }],
  truncated: false,
  imagesOverCap: 0,
};

it('a Miro board lands with stickies inside their frame where Miro had them, lines attached to the shapes they join, and hostile content as plain text', async () => {
  const result = parseMiro(MIRO, newId);
  const frame = result.drafts.find((d) => d.type === 'frame')!;
  const [went, ship] = result.drafts.filter((d) => d.type === 'sticky');
  // Miro gives centres, and a frame's children from its top left: (-600, -400) + (200, 200) is the centre.
  expect([went.frameId, went.x + went.w / 2, went.y + went.h / 2]).toEqual([frame.id, -400, -200]);
  expect(inside(went, frame) && inside(ship, frame)).toBe(true);
  // Untrusted HTML reads as its text: no tag, handler or script reaches the board.
  expect(text(ship)).toBe('Ship it & tell everyone');
  expect(JSON.stringify(result)).not.toMatch(/<script|onerror|<img/i);
  expect(result.tags).toEqual([{ id: went.id, names: ['Keep'] }]);

  const plan = result.drafts.find((d) => text(d) === 'Plan')!;
  const decide = result.drafts.find((d) => text(d) === 'Ship?')!;
  const lines = result.drafts.filter((d): d is ConnectorElement => d.type === 'connector');
  expect(lines).toHaveLength(1); // the one to an item Freero leaves out is reported, not left dangling
  expect([lines[0].start.elementId, lines[0].end.elementId, lines[0].routing, lines[0].strokeStyle, text(lines[0])]).toEqual([plan.id, decide.id, 'elbow', 'dashed', 'then']);
  expect(result.report.skipped.map((s) => s.what)).toEqual(['“mindmap node” items (left out)', 'Lines not attached at both ends (left out)']);

  board = createTestBoard({ users: ['ann'], features: [manifest] });
  const [ed] = board.editors('import');
  await placeImport(ed, result, { x: 0, y: 0 });
  const placed = ed.getElements();
  const line = placed.find((e): e is ConnectorElement => e.type === 'connector')!;
  expect([line.start.elementId, line.end.elementId]).toEqual([plan.id, decide.id]); // still attached once placed
  ed.undo();
  expect(ed.getElements()).toEqual([]);
});

// Mural's "Download to CSV": text HTML-escaped by Mural, positions of a 138-pixel sticky grid, an
// area, who last edited each sticky.
const MURAL = [
  'ID,Text,BG Color,Sticky type,Border line,Position X,Position Y,Area,Link to,Last Updated By,Last Updated,Last Content Edited By,Last Content Edited,Tags,Integration Labels',
  '0-1,Keep &amp; grow,#FCF281,Rectangle,,0,0,Went well,https://example.com/a,Jane Q Public,2026-10-01,Jane Q Public,2026-10-01,"keep, team",',
  '0-2,&lt;script&gt;alert(1)&lt;/script&gt;Fix CI,#FEBBBE,Rectangle,,148,0,Went well,javascript:alert(1),Jane Q Public,2026-10-01,Jane Q Public,2026-10-01,,',
  '0-3,"Ask ""why""",#AAED92,Rectangle,,0,148,,,Jane Q Public,2026-10-01,Jane Q Public,2026-10-01,,',
].join('\r\n');

it('Mural’s CSV keeps its stickies apart where Mural had them, puts an area’s stickies in a frame, and never brings who edited them', () => {
  expect(kindOfFile('retro.csv', MURAL)).toBe('mural');
  const result = parseMural(MURAL, newId);
  const stickies = result.drafts.filter((d) => d.type === 'sticky');
  const frame = result.drafts.find((d) => d.type === 'frame')!;
  expect(stickies.map(text)).toEqual(['Keep & grow', '<script>alert(1)</script>Fix CI', 'Ask "why"']);
  // Text, not markup: what Mural escaped stays visible characters in the sticky's rich text.
  expect((stickies[1] as { text: string }).text).not.toContain('<script');
  for (const a of stickies) for (const b of stickies) if (a !== b) expect(overlap(a, b)).toBe(false);
  expect(stickies[0].x).toBeLessThan(stickies[1].x);
  expect(stickies[0].y).toBeLessThan(stickies[2].y);
  expect([(frame as { title: string }).title, stickies[0].frameId, stickies[1].frameId, stickies[2].frameId]).toEqual(['Went well', frame.id, frame.id, undefined]);
  expect(inside(stickies[0], frame) && inside(stickies[1], frame)).toBe(true);
  expect([(stickies[0] as { link?: string }).link, (stickies[1] as { link?: string }).link]).toEqual(['https://example.com/a', undefined]);
  expect(result.tags).toEqual([{ id: stickies[0].id, names: ['keep', 'team'] }]);
  expect(JSON.stringify(result)).not.toContain('Jane Q Public');
});

it('a CSV that is neither Mural’s nor Lucid’s export is left to the CSV import', () => {
  expect(kindOfFile('people.csv', 'Text,Status,Assignee\r\nShip it,todo,Ann')).toBeNull();
  expect(kindOfFile('notes.csv', 'Content,Created by\r\nIdea,Ann')).toBeNull(); // FigJam's sticky CSV
});

// Lucid's "CSV of Shape Data" from a Lucidspark board: a frame holding three steps joined by lines,
// a loose sticky, a comment, a container chain that loops back on itself.
const LUCID = [
  'Id,Name,Shape Library,Page ID,Contained By,Group,Line Source,Line Destination,Source Arrow,Destination Arrow,Status,Text Area 1,Text Area 2,Comments,Tags',
  '1,Document,,,,,,,,,Draft,Checkout flow,,,',
  '2,Page,,,,,,,,,,Page 1,,,',
  '3,SparkFrameBlock,Lucidspark Shapes,2,,,,,,,,Happy path,,,',
  '4,Process,Flowchart Shapes,2,3,,,,,,,Add to cart,,Is this the first step?,',
  '5,Decision,Flowchart Shapes,2,3,,,,,,,In stock?,,,',
  '6,Terminator,Flowchart Shapes,2,3,,,,,,,"Pay",<b>now</b>,,',
  '7,Line,,2,,,4,5,None,Arrow,,,,,',
  '8,Line,,2,,,5,6,None,Arrow,,yes,,,',
  '9,Sticky Note,Lucidspark Shapes,2,,,,,,,,Remember coupons,,,"promo; later"',
  '10,Process,Flowchart Shapes,2,11,,,,,,,Loop A,,,',
  '11,Process,Flowchart Shapes,2,10,,,,,,,Loop B,,,',
  '12,Line,,2,,,4,99,None,Arrow,,,,,',
].join('\n');

it('Lucid’s CSV lays its items out without overlaps, a container as a frame holding its steps, lines attached to the right items — and a looping container chain doesn’t hang', () => {
  expect(kindOfFile('flow.csv', LUCID)).toBe('lucid');
  const result = parseLucid(LUCID, newId);
  const byText = (t: string) => result.drafts.find((d) => text(d) === t || (d.type === 'frame' && (d as { title: string }).title === t))!;
  const [frame, cart, stock, pay, sticky] = [byText('Happy path'), byText('Add to cart'), byText('In stock?'), byText('Pay\nnow'), byText('Remember coupons')];
  expect([frame.type, cart.frameId, stock.frameId, pay.frameId, sticky.type, sticky.frameId]).toEqual(['frame', frame.id, frame.id, frame.id, 'sticky', undefined]);
  expect([cart, stock, pay].every((d) => inside(d, frame))).toBe(true);
  // Connected steps run left to right.
  expect(cart.x).toBeLessThan(stock.x);
  expect(stock.x).toBeLessThan(pay.x);
  const lines = result.drafts.filter((d): d is ConnectorElement => d.type === 'connector');
  expect(lines.map((l) => [l.start.elementId, l.end.elementId, l.endCap])).toEqual([
    [cart.id, stock.id, 'arrow'],
    [stock.id, pay.id, 'arrow'],
  ]);
  // Whatever no frame holds (a nested container is a frame drawn inside its container's frame).
  const top = result.drafts.filter((d) => d.type !== 'connector' && !result.drafts.some((f) => f.type === 'frame' && f !== d && inside(d, f)));
  for (const a of top) for (const b of top) if (a !== b) expect(overlap(a, b)).toBe(false);
  expect(byText('Loop A').frameId ?? null).toBeNull();
  expect(result.tags).toEqual([{ id: sticky.id, names: ['promo', 'later'] }]);
  // Comments would be posted under the importer's name: counted, not posted.
  expect(result.report.skipped).toContainEqual({ what: 'Comments (not imported: they would be posted under your name)', count: 1 });
  expect(result.report.skipped).toContainEqual({ what: 'Lines not attached at both ends (left out)', count: 1 });
});
