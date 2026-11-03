// The lines a connector draws its jumps over (jumps.ts): other connectors beneath it whose
// stored bounds (with a margin: a line's cached box can lag its detours) meet its route's, with
// their routes.
//
// Every line in view asks on every board change, so the answer is kept cheap: one grid index of
// the board's lines per editor, updated in place from the lines that changed (a write to a line
// is a new element object), and each line's last answer, reused while no changed line came near
// it. A line's route is computed once per element object. So an edit elsewhere on a big board
// costs every line in view a lookup, and a drag re-asks only the lines near what moved.
import type { BoardElement, ConnectorElement } from '@freero/shared';
import type { Editor, Point, Rect } from '@engine';
import { drawnAbove } from './jumps';
import { connectorGeometry, drawnRoutes, localAnchors } from './model';
import { liveObstacles } from './obstacles';

type Lines = Pick<Editor, 'getElement' | 'getElements' | 'getDefinition'>;

const CELL = 512;
/** Margin around a line's stored box: an elbow line created with only its ends' box detours past it. */
const SLACK = 48;
const overlaps = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
const slackBox = (c: ConnectorElement): Rect => ({ x: c.x - SLACK, y: c.y - SLACK, w: c.w + 2 * SLACK, h: c.h + 2 * SLACK });

interface Entry {
  c: ConnectorElement;
  box: Rect;
  /** The last query that took it (a line spans many cells). */
  seen: number;
}

class LineIndex {
  private cells = new Map<string, Entry[]>();
  private entries = new Map<ConnectorElement, Entry>();
  private queries = 0;
  private each(r: Rect, f: (key: string) => void) {
    for (let x = Math.floor(r.x / CELL); x <= Math.floor((r.x + r.w) / CELL); x++) for (let y = Math.floor(r.y / CELL); y <= Math.floor((r.y + r.h) / CELL); y++) f(`${x}:${y}`);
  }
  add(c: ConnectorElement) {
    const e = { c, box: slackBox(c), seen: 0 };
    this.entries.set(c, e);
    this.each(e.box, (key) => {
      const list = this.cells.get(key);
      if (list) list.push(e);
      else this.cells.set(key, [e]);
    });
  }
  remove(c: ConnectorElement) {
    const e = this.entries.get(c);
    if (!e) return;
    this.entries.delete(c);
    this.each(e.box, (key) => {
      const list = this.cells.get(key);
      const i = list ? list.indexOf(e) : -1;
      if (i >= 0) list!.splice(i, 1);
    });
  }
  query(r: Rect): ConnectorElement[] {
    const q = ++this.queries;
    const out: ConnectorElement[] = [];
    this.each(r, (key) => {
      for (const e of this.cells.get(key) ?? []) {
        if (e.seen === q) continue;
        e.seen = q;
        if (overlaps(e.box, r)) out.push(e.c);
      }
    });
    return out;
  }
}

/** The board's lines as one editor last saw them, and what changed with the latest board state. */
interface Tracker {
  elements: readonly BoardElement[];
  lines: Map<string, ConnectorElement>;
  index: LineIndex;
  version: number;
  /** Boxes (old and new) of the lines that changed in `version`. */
  changed: Rect[];
}

const trackers = new WeakMap<object, Tracker>();

function track(editor: Lines, elements: readonly BoardElement[]): Tracker {
  let t = trackers.get(editor);
  if (t && t.elements === elements) return t;
  const lines = new Map<string, ConnectorElement>();
  for (const el of elements) if (el.type === 'connector') lines.set(el.id, el);
  if (!t) {
    const index = new LineIndex();
    for (const c of lines.values()) index.add(c);
    t = { elements, lines, index, version: 0, changed: [] };
    trackers.set(editor, t);
    return t;
  }
  const changed: Rect[] = [];
  for (const [id, c] of t.lines)
    if (lines.get(id) !== c) {
      t.index.remove(c);
      changed.push(slackBox(c));
    }
  for (const [id, c] of lines)
    if (t.lines.get(id) !== c) {
      t.index.add(c);
      changed.push(slackBox(c));
    }
  t.elements = elements;
  t.lines = lines;
  if (changed.length) {
    t.version++;
    t.changed = changed;
  }
  return t;
}

/** The route `c` is drawn with (the renderer's, or the same computation against the live board). */
export function routeOf(editor: Lines, c: ConnectorElement): Point[] {
  let poly = drawnRoutes.get(c);
  if (!poly) {
    poly = connectorGeometry(c, (id) => editor.getElement(id) ?? undefined, localAnchors(editor), liveObstacles(editor)).route.poly;
    drawnRoutes.set(c, poly);
  }
  return poly;
}

/** A line's last answer: for which board version, along which route, near which box. */
const answers = new WeakMap<ConnectorElement, { tracker: Tracker; version: number; route: Point[]; box: Rect; routes: Point[][] }>();

/** Routes of the lines beneath `c` (drawn along `route`) that may cross it (in no particular order). */
export function routesBeneath(editor: Lines, elements: readonly BoardElement[], c: ConnectorElement, route: Point[]): Point[][] {
  const t = track(editor, elements);
  const last = answers.get(c);
  if (last && last.tracker === t && last.route === route) {
    if (last.version === t.version) return last.routes;
    // Only lines that changed can change the answer, and only those near this one.
    if (last.version === t.version - 1 && !t.changed.some((r) => overlaps(r, last.box))) {
      last.version = t.version;
      return last.routes;
    }
  }
  const xs = route.map((p) => p.x);
  const ys = route.map((p) => p.y);
  const box = { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  const routes = t.index
    .query(box)
    .filter((o) => o.id !== c.id && drawnAbove(c, o))
    .map((o) => routeOf(editor, o));
  answers.set(c, { tracker: t, version: t.version, route, box, routes });
  return routes;
}

/** The same routes, in any order (by identity: a route is recomputed only when its line changed). */
export function sameRoutes(a: Point[][], b: Point[][]): boolean {
  if (a.length !== b.length) return false;
  if (a.every((r, i) => r === b[i])) return true;
  const set = new Set(a);
  return b.every((r) => set.has(r));
}
