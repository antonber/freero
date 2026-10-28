// Insert from text and diagrams as code: what lands, and what an edit of the source keeps.
import { describe, expect, it } from 'vitest';
import { looksLikeMermaid, richTextToPlain, type BoardElement, type ConnectorElement, type ShapeElement } from '@freero/shared';
import { createTestBoard, type Editor } from '@engine';
import manifest from './feature';
import { DIAGRAMS, insertLaid, layoutText, updateDiagram } from './lib/insert';
import { parseRows } from './lib/parse';
import type { DiagramRecord } from './lib/reconcile';

const FLOW = ['flowchart TD', '  A[Start] --> B{Valid?}', '  B -- yes --> C[Save]', '  B -- no --> D[Reject]', '  D --> A'].join('\n');

function board() {
  const b = createTestBoard({ users: ['ann'], features: [manifest] });
  return { b, ed: b.editors('from-text')[0] };
}
const shapes = (ed: Editor) => ed.getElements().filter((e): e is ShapeElement => e.type === 'shape');
const shapeNamed = (ed: Editor, t: string) => shapes(ed).find((s) => richTextToPlain(s.text) === t);
const lines = (ed: Editor) => ed.getElements().filter((e): e is ConnectorElement => e.type === 'connector');
const insertFlow = (ed: Editor, src = FLOW) => insertLaid(ed, 'mermaid', src, layoutText('mermaid', src), { x: 0, y: 0 });
const onlyDiagram = (ed: Editor) => ed.collection<DiagramRecord>(DIAGRAMS).entries()[0];

describe('diagrams as code', () => {
  it('editing the source keeps the diagram’s items: styles and hand moves stay, renames change in place, dropped nodes go, new ones arrive attached — one undo step', () => {
    const { b, ed } = board();
    try {
      insertFlow(ed);
      const [id] = onlyDiagram(ed);
      const before = { a: shapeNamed(ed, 'Start')!, b: shapeNamed(ed, 'Valid?')!, c: shapeNamed(ed, 'Save')!, d: shapeNamed(ed, 'Reject')! };
      ed.update<ShapeElement>(before.b.id, { fill: '#FFC98B' });
      ed.update<ShapeElement>(before.c.id, { x: before.c.x + 400, y: before.c.y + 40 });
      const linesToD = lines(ed).filter((l) => l.start.elementId === before.d.id || l.end.elementId === before.d.id).map((l) => l.id);
      expect(linesToD).toHaveLength(2);

      const edited = ['flowchart TD', '  A[Begin] --> B{Valid?}', '  B -- yes --> C[Save]', '  C --> E[(Archive)]'].join('\n');
      updateDiagram(ed, id, edited);

      const a = shapeNamed(ed, 'Begin')!;
      expect(a.id).toBe(before.a.id);
      expect(shapeNamed(ed, 'Valid?')).toMatchObject({ id: before.b.id, fill: '#FFC98B' });
      expect(shapeNamed(ed, 'Save')).toMatchObject({ id: before.c.id, x: before.c.x + 400, y: before.c.y + 40 });
      expect(ed.getElement(before.d.id)).toBeFalsy();
      for (const l of linesToD) expect(ed.getElement(l)).toBeFalsy();
      const e = shapeNamed(ed, 'Archive')!;
      expect(e.shape).toBe('cylinder');
      expect(lines(ed).some((l) => l.start.elementId === before.c.id && l.end.elementId === e.id)).toBe(true);
      expect(lines(ed).find((l) => l.start.elementId === before.b.id && l.end.elementId === before.c.id)?.label).toBe('yes');
      expect(ed.collection<DiagramRecord>(DIAGRAMS).get(id)!.source).toBe(edited);

      ed.undo();
      expect(shapeNamed(ed, 'Reject')?.id).toBe(before.d.id);
      expect(shapeNamed(ed, 'Archive')).toBeUndefined();
      expect(shapeNamed(ed, 'Start')?.id).toBe(before.a.id);
      expect(ed.collection<DiagramRecord>(DIAGRAMS).get(id)!.source).toBe(FLOW);
    } finally {
      b.destroy();
    }
  });

  it('a diagram dragged elsewhere is re-laid out where it now is, not where it was inserted', () => {
    const { b, ed } = board();
    try {
      insertFlow(ed);
      const [id] = onlyDiagram(ed);
      const all = ed.getElements().filter((el) => el.type !== 'connector');
      ed.updateMany(all.map((el) => ({ id: el.id, patch: { x: el.x + 2000, y: el.y + 900 } })));
      const start = shapeNamed(ed, 'Start')!;
      updateDiagram(ed, id, FLOW.replace('C[Save]', 'C[Save it]'));
      expect(shapeNamed(ed, 'Save it')!.x).toBeGreaterThan(1500);
      expect(shapeNamed(ed, 'Start')).toMatchObject({ x: start.x, y: start.y });
    } finally {
      b.destroy();
    }
  });

  it('"Re-lay out" puts items moved by hand back in the layout, but keeps their styling', () => {
    const { b, ed } = board();
    try {
      insertFlow(ed);
      const [id, record] = onlyDiagram(ed);
      const save = shapeNamed(ed, 'Save')!;
      ed.update<ShapeElement>(save.id, { x: save.x + 500, fill: '#C2EFB0' });
      updateDiagram(ed, id, record.source, { keepMoved: false });
      expect(shapeNamed(ed, 'Save')).toMatchObject({ id: save.id, x: save.x, y: save.y, fill: '#C2EFB0' });
    } finally {
      b.destroy();
    }
  });

  it('a Mermaid mind map edited in source keeps its topics (and their colours), takes new ones under their parent, and stays tidy', () => {
    const { b, ed } = board();
    try {
      const src = ['mindmap', '  root((Trip))', '    Flights', '    Hotel', '      Downtown'].join('\n');
      insertLaid(ed, 'mermaid', src, layoutText('mermaid', src), { x: 0, y: 0 });
      const [id] = onlyDiagram(ed);
      type Topic = BoardElement & { text: string; parentId: string | null; color: string };
      const topic = (t: string) => ed.getElements().find((e) => e.type === 'mindmap' && richTextToPlain((e as Topic).text) === t) as Topic | undefined;
      const hotel = topic('Hotel')!;
      ed.update<Topic>(hotel.id, { color: '#14B8A6' });
      updateDiagram(ed, id, ['mindmap', '  root((Trip))', '    Flights', '      Window seat', '    Hotel', '      Downtown'].join('\n'));
      expect(topic('Hotel')).toMatchObject({ id: hotel.id, color: '#14B8A6' });
      expect(topic('Window seat')!.parentId).toBe(topic('Flights')!.id);
      const nodes = ed.getElements().filter((e) => e.type === 'mindmap');
      for (let i = 0; i < nodes.length; i++)
        for (let j = i + 1; j < nodes.length; j++) {
          const [p, q] = [nodes[i], nodes[j]];
          expect(p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h, `${p.id} × ${q.id}`).toBe(false);
        }
    } finally {
      b.destroy();
    }
  });

  it('a diagram inserted as a private-mode draft keeps no source in the shared doc (it would show the draft’s text to everyone)', () => {
    const board = createTestBoard({ users: ['ann', 'bob'], features: [manifest] });
    try {
      const [ann, bob] = board.editors('from-text');
      ann.setPrivatePlacement(() => true);
      insertFlow(ann);
      expect(shapeNamed(ann, 'Start')).toBeTruthy();
      board.sync();
      expect(shapeNamed(bob, 'Start')).toBeUndefined();
      expect(JSON.stringify(bob.collection(DIAGRAMS).entries())).not.toContain('Start');
    } finally {
      board.destroy();
    }
  });

  it('only a diagram header on its own line reads as Mermaid when pasted (prose about graphs stays text)', () => {
    expect(looksLikeMermaid('graph LR\n  A --> B')).toBe(true);
    expect(looksLikeMermaid('%% notes\nsequenceDiagram\n  A->>B: hi')).toBe(true);
    expect(looksLikeMermaid('Graph of our sales by region, see below')).toBe(false);
    expect(looksLikeMermaid('mindmap ideas for the offsite')).toBe(false);
  });
});

describe('tables from text', () => {
  it("a Markdown table's separator row is not read as a row of cells", () => {
    expect(parseRows('| Risk | Owner |\n|:---|---:|\n| Data loss | Ann |')).toEqual([
      ['Risk', 'Owner'],
      ['Data loss', 'Ann'],
    ]);
  });
});

