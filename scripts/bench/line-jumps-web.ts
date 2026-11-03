// Line jumps benchmark (#115): what line jumps add per frame on a 500-connector board, in a real
// engine session (createTestBoard: real Yjs doc, real Editor, every feature as the app loads
// them), timed with performance.now(). Not a test: timings depend on the machine; it prints the
// numbers and how they compare with a 60 fps frame (16.7 ms).
//
//   npm run bench:line-jumps [-- --lines 500] [--repeat 5]
//
// On every board change each connector's renderer finds the lines beneath it near its route
// (routesBeneath) and, when those changed, works out its hops (lineJumps): `jumpPass` does that
// for every line. Routes themselves are computed first and not counted (drawing lines costs that
// with or without jumps). Scenarios: a diagram (shapes in a grid, elbow lines between seeded
// random pairs — far denser than real diagrams) and a lattice (straight lines all crossing each
// other: the most hops possible).
import type { ConnectorElement, ShapeElement } from '@freero/shared';
import { createTestBoard, type Editor } from '@engine';
import { features } from '../../apps/web/src/app/board/features';
import { routeOf, routesBeneath, sameRoutes } from '../../apps/web/src/features/connector/lib/beneath';
import { jumpRadius, lineJumps } from '../../apps/web/src/features/connector/lib/jumps';
import { buildConnector, endpoint, styleFromOptions } from '../../apps/web/src/features/connector/lib/model';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const LINES = Number(opt('lines', '500'));
const REPEAT = Number(opt('repeat', '5'));
const FRAME = 1000 / 60;

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function diagram(ed: Editor): string[] {
  const cols = 20;
  const rows = Math.ceil((LINES * 0.6) / cols);
  const ids: string[] = [];
  ed.transact(() => {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        ids.push(
          ed.create({
            type: 'shape', shape: 'rect', x: c * 260, y: r * 200, w: 140, h: 80, text: `S${r}.${c}`, fill: '#fff', fillOpacity: 1, stroke: '#222',
            strokeWidth: 2, strokeStyle: 'solid', fontFamily: 'sans', fontSize: 16, textColor: '#111', align: 'center', vAlign: 'middle',
          } as never),
        );
    // Each line joins an item to one up to three columns / rows away (lines cross a lot nearby).
    for (let i = 0; i < LINES; i++) {
      const ai = Math.floor(rnd() * ids.length);
      const r0 = Math.floor(ai / cols);
      const c0 = ai % cols;
      const r1 = Math.min(rows - 1, Math.max(0, r0 + Math.floor(rnd() * 7) - 3));
      let c1 = Math.min(cols - 1, Math.max(0, c0 + Math.floor(rnd() * 7) - 3));
      if (r1 === r0 && c1 === c0) c1 = c0 === 0 ? 1 : c0 - 1;
      const a = ids[ai];
      const b = ids[r1 * cols + c1];
      const A = ed.getElement<ShapeElement>(a)!;
      const B = ed.getElement<ShapeElement>(b)!;
      ed.create(buildConnector(ed, endpoint({ id: a, anchor: 'auto' }, { x: A.x, y: A.y }), endpoint({ id: b, anchor: 'auto' }, { x: B.x, y: B.y }), styleFromOptions({ routing: 'elbow' })));
    }
  });
  return ids;
}

function lattice(ed: Editor): string[] {
  const half = Math.floor(LINES / 2);
  ed.transact(() => {
    for (let i = 0; i < half; i++) ed.create(buildConnector(ed, { x: 0, y: i * 24 }, { x: half * 24, y: i * 24 }, styleFromOptions({ routing: 'straight', endCap: 'none' })));
    for (let i = 0; i < LINES - half; i++) ed.create(buildConnector(ed, { x: i * 24 + 12, y: -12 }, { x: i * 24 + 12, y: half * 24 }, styleFromOptions({ routing: 'straight', endCap: 'none' })));
  });
  return [];
}

const lines = (ed: Editor) => ed.getElements().filter((e): e is ConnectorElement => e.type === 'connector');
const routeAll = (ed: Editor) => lines(ed).forEach((c) => routeOf(ed, c));

/** What every line's renderer does for jumps on one board change; `drawn` is what each drew last. */
function jumpPass(ed: Editor, drawn: Map<string, { beneath: unknown; hops: number }>) {
  const all = ed.getElements();
  let hops = 0;
  let redrawn = 0;
  for (const c of lines(ed)) {
    const route = routeOf(ed, c);
    const beneath = routesBeneath(ed, all, c, route);
    const was = drawn.get(c.id);
    if (was && sameRoutes(was.beneath as never, beneath)) {
      hops += was.hops;
      continue;
    }
    redrawn++;
    const n = lineJumps(route, beneath, jumpRadius(c.strokeWidth)).length;
    drawn.set(c.id, { beneath, hops: n });
    hops += n;
  }
  return { hops, redrawn };
}

function report(name: string, ms: number[]) {
  const med = [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)];
  console.log(`  ${name.padEnd(76)} ${med.toFixed(1).padStart(6)} ms  (${med <= FRAME ? 'within' : 'OVER'} a 16.7 ms frame)`);
}

for (const [name, build] of [
  ['diagram', diagram],
  ['lattice', lattice],
] as const) {
  const first: number[] = [];
  const drag: number[] = [];
  const unrelated: number[] = [];
  let detail = '';
  for (let r = 0; r < REPEAT; r++) {
    seed = 7;
    const board = createTestBoard({ users: ['ann'], features });
    const [ed] = board.editors('connector');
    ed.updateSettings({ lineJumps: true });
    const shapes = build(ed);
    const drawn = new Map<string, { beneath: unknown; hops: number }>();
    routeAll(ed);
    let t = performance.now();
    const cold = jumpPass(ed, drawn);
    first.push(performance.now() - t);
    // One step of dragging an item (a shape and its lines; in the lattice, one line).
    const moved = shapes.length ? shapes[Math.floor(shapes.length / 2)] : lines(ed)[Math.floor(LINES / 4)].id;
    const m = ed.getElement(moved)!;
    if (m.type === 'connector') ed.update<ConnectorElement>(moved, { start: { x: m.start.x, y: m.start.y + 6 }, end: { x: m.end.x, y: m.end.y + 6 } });
    else ed.update(moved, { x: m.x + 30, y: m.y + 20 } as never);
    routeAll(ed);
    t = performance.now();
    const step = jumpPass(ed, drawn);
    drag.push(performance.now() - t);
    // An edit that touches no line.
    ed.create({ type: 'text', x: -900, y: -900, w: 100, h: 30, text: 'Note', fontFamily: 'sans', fontSize: 16, textColor: '#111', align: 'left', background: 'transparent', autoWidth: true } as never);
    t = performance.now();
    jumpPass(ed, drawn);
    unrelated.push(performance.now() - t);
    detail = `${cold.hops} hops; ${step.redrawn} lines redraw their hops after the move`;
    board.destroy();
  }
  console.log(`\n${name}: ${LINES} connectors, ${detail}`);
  report('first draw: every line finds the lines beneath it and its hops', first);
  report('one drag step: every line asks again, those near the move redraw hops', drag);
  report('an edit elsewhere: every line asks again, none redraws', unrelated);
}
