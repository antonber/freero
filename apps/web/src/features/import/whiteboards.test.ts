// Boards from other whiteboards (#163 Mural's CSV, #165 Lucid's CSV):
// what lands on a real engine board, from data shaped the way each tool writes it.
import { expect, it } from 'vitest';
import { richTextToPlain, type BoardElement, type ConnectorElement, type ElementDraft } from '@freero/shared';
import { parseLucid } from './lib/lucid';
import { parseMural } from './lib/mural';
import { kindOfFile } from './lib/insert';

let seq = 0;
const newId = () => `id${++seq}`;
const text = (el: BoardElement | ElementDraft) => richTextToPlain(String((el as { text?: string }).text ?? (el as { title?: string }).title ?? (el as { label?: string }).label ?? ''));
const inside = (el: ElementDraft, f: ElementDraft) => el.x >= f.x && el.y >= f.y && el.x + el.w <= f.x + f.w && el.y + el.h <= f.y + f.h;
const overlap = (a: ElementDraft, b: ElementDraft) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

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
