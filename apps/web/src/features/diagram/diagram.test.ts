// Diagram containers (#117) and their layers (#118): the failures that matter — collaborators'
// steps landing on each other, hand-placed steps being yanked back, hidden layers losing content,
// layer locks lifting the wrong locks, a reflow that undo can't take back in one step.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { layoutStructure, type BoardElement, type DiagramElement, type DiagramLayout, type ShapeElement } from '@freero/shared';
import { createTestBoard, type Editor, type FeatureBundle, type NewElement, type TestBoard } from '@engine';
import manifest from './feature';
import elementDef from './element';
import commands from './commands';
import { addLayer, focusDiagram, moveToLayer, patchLayer, setLayout } from './lib/actions';

const bundle: FeatureBundle = { manifest, elements: [elementDef], tools: [], formats: [], panels: [], commands };

let board: TestBoard | null = null;
afterEach(() => {
  board?.destroy();
  board = null;
  vi.useRealTimers();
});

function setup(users = ['ann']): Editor[] {
  board = createTestBoard({ users, features: [bundle] });
  return board.editors('diagram');
}

const step = (x: number, y: number, frameId: string | null, text = 'Step'): NewElement<'shape'> => ({
  type: 'shape',
  x,
  y,
  w: 160,
  h: 72,
  frameId,
  shape: 'roundRect',
  fill: '#FFFFFF',
  fillOpacity: 1,
  stroke: '#4B4A63',
  strokeWidth: 2,
  strokeStyle: 'solid',
  text,
  fontFamily: 'sans',
  fontSize: 16,
  textColor: '#17162B',
  align: 'center',
  vAlign: 'middle',
});

const line = (a: BoardElement, b: BoardElement, frameId: string | null): NewElement<'connector'> => ({
  type: 'connector',
  x: a.x,
  y: a.y,
  w: 1,
  h: 1,
  frameId,
  start: { elementId: a.id, anchor: 'bottom', x: a.x + a.w / 2, y: a.y + a.h },
  end: { elementId: b.id, anchor: 'top', x: b.x + b.w / 2, y: b.y },
  routing: 'straight',
  stroke: '#2B2A44',
  strokeWidth: 2,
  strokeStyle: 'solid',
  startCap: 'none',
  endCap: 'arrow',
  label: '',
});

/** A diagram with a chain of steps A → B → … laid out by `layout`. */
function diagramWith(ed: Editor, texts: string[], layout: DiagramLayout = 'down') {
  const did = ed.create<'diagram'>({ type: 'diagram', x: 0, y: 0, w: 360, h: 240, title: 'Flow', layout });
  const ids: string[] = [];
  for (const t of texts) {
    ids.push(ed.create(step(40, 80, did, t)));
    if (ids.length > 1) ed.create(line(ed.getElement(ids[ids.length - 2])!, ed.getElement(ids[ids.length - 1])!, did));
  }
  return { did, ids, d: () => ed.getElement<DiagramElement>(did)! };
}

const boxes = (ed: Editor, did: string) => ed.getElements().filter((el) => el.frameId === did && el.type !== 'connector');
const overlaps = (a: BoardElement, b: BoardElement) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
function overlapping(els: BoardElement[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) if (overlaps(els[i], els[j])) out.push(`${els[i].id}/${els[j].id}`);
  return out;
}
const at = (ed: Editor, id: string) => {
  const el = ed.getElement(id)!;
  return { x: el.x, y: el.y };
};
const snapshot = (ed: Editor) => JSON.stringify(ed.getElements());

describe('the live layout', () => {
  it('two people adding a step at the same moment both keep their steps, and nothing overlaps once the merge is laid out — by one of them, once', () => {
    vi.useFakeTimers();
    const [ann, bob] = setup(['ann', 'bob']);
    const { did, ids } = diagramWith(ann, ['Start', 'Check', 'Ship']);
    board!.sync();
    vi.advanceTimersByTime(60_000); // the diagram was drawn long ago

    // Both add a step before seeing each other's: each reflows a diagram without the other's step.
    const mine = ann.create(step(40, 80, did, 'Mine'));
    const theirs = bob.create(step(40, 80, did, 'Theirs'));
    board!.sync();
    expect(overlapping(boxes(ann, did)).length).toBeGreaterThan(0); // merged: on top of each other

    vi.advanceTimersByTime(1000);
    board!.sync();
    for (const ed of [ann, bob]) {
      expect(boxes(ed, did).map((el) => el.id).sort()).toEqual([...ids, mine, theirs].sort());
      expect(overlapping(boxes(ed, did))).toEqual([]);
    }
    expect(snapshot(ann)).toBe(snapshot(bob));

    // And nobody keeps rewriting it (no ping-pong between the two of them).
    const settled = snapshot(ann);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(2000);
      board!.sync();
    }
    expect(snapshot(ann)).toBe(settled);
    expect(snapshot(bob)).toBe(settled);
  });

  it('a step moved by hand stays where it was put when the diagram later reflows, and the steps laid out after it never land on it', () => {
    const [ed] = setup();
    const { did, ids } = diagramWith(ed, ['Start', 'Check', 'Ship']);
    const [, check] = ids;
    // Dragged to the right, staying inside the diagram (out of it, it would leave the diagram).
    ed.beginGesture();
    ed.moveBy([{ id: check, dx: 180, dy: 30 }]);
    ed.endGesture();
    const put = at(ed, check);
    expect(ed.getElement(check)!.diagramPinned).toBe(true);
    // New steps reflow the diagram (one between Start and Ship, two beside Start).
    for (const t of ['Retry', 'Notify', 'Audit']) {
      const n = ed.create(step(40, 80, did, t));
      ed.create(line(ed.getElement(ids[0])!, ed.getElement(n)!, did));
    }
    expect(at(ed, check)).toEqual(put);
    expect(overlapping(boxes(ed, did))).toEqual([]);
    // "Lay out again" takes it back into the flow.
    ed.select([did]);
    ed.runCommand('diagram.relayout');
    expect(ed.getElement(check)!.diagramPinned).toBeFalsy();
    expect(at(ed, check)).not.toEqual(put);
  });

  it('undo of a change that reflowed the diagram takes the change and the reflow back in one step', () => {
    const [ed] = setup();
    const { did, ids } = diagramWith(ed, ['Start', 'Check', 'Ship']);
    const before = ids.map((id) => at(ed, id));
    setLayout(ed, did, 'right');
    expect(ids.map((id) => at(ed, id))).not.toEqual(before);
    ed.undo();
    expect(ed.getElement<DiagramElement>(did)!.layout).toBe('down');
    expect(ids.map((id) => at(ed, id))).toEqual(before);

    // A branch off Start (a step and its line, as a quick-add makes them).
    let added = '';
    ed.transact(() => {
      added = ed.create(step(40, 80, did, 'Extra'));
      ed.create(line(ed.getElement(ids[0])!, ed.getElement(added)!, did));
    });
    expect(ids.map((id) => at(ed, id))).not.toEqual(before);
    ed.undo();
    expect(ed.getElement(added)).toBeUndefined();
    expect(ids.map((id) => at(ed, id))).toEqual(before);
  });

  it('a diagram that arrives laid out (inserted from Mermaid) keeps the drawing its own layout gave it until its structure changes', () => {
    const [ed] = setup();
    let n = 0;
    const laid = layoutStructure({ kind: 'mermaid', source: 'flowchart LR\n  A[Plan] --> B[Build]\n  A --> C[Test]\n  B --> D[Ship]\n  C --> D' }, { newId: () => `m${++n}` });
    ed.createMany(laid.elements as unknown as NewElement[]);
    const d = ed.getElements().find((el) => el.type === 'diagram') as DiagramElement;
    expect(d.layout).toBe('right');
    const drawn = laid.elements.filter((el) => el.type === 'shape').map((el) => ({ id: el.id, x: el.x, y: el.y }));
    expect(drawn.map((s) => ({ id: s.id, ...at(ed, s.id) }))).toEqual(drawn);
    // A text edit, a restyle or a move of the whole diagram never reflows it.
    ed.update<ShapeElement>(drawn[0].id, { text: 'Plan it', fill: '#FFC98B' });
    ed.moveBy([{ id: d.id, dx: 100, dy: 50 }]);
    expect(drawn.map((s) => at(ed, s.id))).toEqual(drawn.map((s) => ({ x: s.x + 100, y: s.y + 50 })));
    expect(ed.getElements().some((el) => el.diagramPinned)).toBe(false);
    // A new step does.
    ed.create(step(d.x + 40, d.y + 80, d.id, 'Review'));
    expect(overlapping(boxes(ed, d.id))).toEqual([]);
  });
});

describe('layers', () => {
  it('hiding a layer hides its steps and the lines touching them for everyone, and deletes nothing: showing it brings them back where they were', () => {
    const [ann, bob] = setup(['ann', 'bob']);
    const { did, ids } = diagramWith(ann, ['Client', 'Server']);
    const [client, server] = ids;
    const link = ann.getElements().find((el) => el.type === 'connector')!.id;
    const l2 = addLayer(ann, ann.getElement<DiagramElement>(did)!);
    moveToLayer(ann, ann.getElement<DiagramElement>(did)!, [server], l2);
    patchLayer(ann, ann.getElement<DiagramElement>(did)!, l2, { hidden: true });
    board!.sync();
    const where = at(bob, server);
    for (const ed of [ann, bob]) {
      const s = ed.getElement(server)!;
      expect(ed.hitTest({ x: s.x + s.w / 2, y: s.y + s.h / 2 })?.id).not.toBe(server); // not on the board for anyone
      expect(ed.getBounds([server, link])).toBeNull(); // nor its line (exports and fit leave them out)
      expect(ed.getBounds([client])).not.toBeNull();
      expect(JSON.stringify(ed.getOutline())).toContain(server); // still board content
    }
    patchLayer(bob, bob.getElement<DiagramElement>(did)!, l2, { hidden: null });
    board!.sync();
    expect(at(ann, server)).toEqual(where);
    expect(ann.getBounds([server, link])).not.toBeNull();
  });

  it('locking a layer stops its steps moving; unlocking it lifts only the locks it set — a step someone locked on its own stays locked', () => {
    const [ed] = setup();
    const { did, ids } = diagramWith(ed, ['Client', 'Server'], 'manual');
    const [client, server] = ids;
    ed.update(server, { locked: true }); // locked on its own
    const layer = () => ed.getElement<DiagramElement>(did)!;
    patchLayer(ed, layer(), 'base', { locked: true });
    expect(ed.getElement(client)!.locked).toBe(true);
    const was = at(ed, client);
    ed.moveBy([{ id: client, dx: 50, dy: 0 }]);
    expect(at(ed, client)).toEqual(was);
    patchLayer(ed, layer(), 'base', { locked: null });
    expect(ed.getElement(client)!.locked).toBeFalsy();
    expect(ed.getElement(server)!.locked).toBe(true);
  });
});

describe('focus mode', () => {
  it('while focusing on a diagram, what is outside it can’t be picked or selected; leaving focus gives it back', () => {
    const [ed] = setup();
    const { did, ids } = diagramWith(ed, ['Inside']);
    const outside = ed.create(step(900, 900, null, 'Outside'));
    const o = ed.getElement(outside)!;
    const centre = { x: o.x + o.w / 2, y: o.y + o.h / 2 };
    focusDiagram(ed, did);
    expect(ed.hitTest(centre)).toBeNull();
    expect(ed.elementsInRect({ x: 800, y: 800, w: 400, h: 400 }).map((el) => el.id)).not.toContain(outside);
    ed.select([outside, ids[0]]);
    expect(ed.getSelection()).toEqual([ids[0]]);
    ed.setFocus(null);
    expect(ed.hitTest(centre)?.id).toBe(outside);
  });
});
