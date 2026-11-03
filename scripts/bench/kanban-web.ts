// The browser side of the kanban benchmark (docs/design/kanban-fields-and-views.md §18), run by
// scripts/bench-kanban.mjs through vite-node with the web app's own config (aliases, CSS, glob):
// a real engine session (createTestBoard: real Yjs doc, real Editor, every feature as the app
// loads them), timed with performance.now(). Prints one JSON line per measurement. Not a test.
import { KANBAN_LAYOUT, LAYOUT_LIMITS, kanbanColumnLeft, type CardElement, type FieldDef, type KanbanColumn, type KanbanElement } from '@freero/shared';
import { createTestBoard, type Editor, type TestBoard } from '@engine';
import { features } from '../../apps/web/src/app/board/features';
import { placeRowsOnKanban } from '../../apps/web/src/features/csv/lib/board';
import { rowsToItems, guessMapping, fieldColumns, guessColumnsFrom } from '../../apps/web/src/features/csv/lib/csv';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const SIZES = opt('sizes', '500,1000,2000,5000').split(',').map(Number);
const BIG = Number(opt('big', '5000'));
const REPEAT = Number(opt('repeat', '3'));
const ONLY = opt('only', '');

const COLUMNS: KanbanColumn[] = [
  { id: 'c_todo', title: 'To do', status: 'todo', color: '#8A89A3' },
  { id: 'c_doing', title: 'Doing', status: 'doing', color: '#2E9BF0' },
  { id: 'c_done', title: 'Done', status: 'done', color: '#1FA463' },
];
const PRIORITY: FieldDef = {
  id: 'f_prio',
  name: 'Priority',
  type: 'select',
  options: [
    { id: 'o_p0', label: 'P0', color: '#E5484D' },
    { id: 'o_p1', label: 'P1', color: '#F5A524' },
    { id: 'o_p2', label: 'P2', color: '#2E9BF0' },
  ],
};
const POINTS: FieldDef = { id: 'f_pts', name: 'Points', type: 'number' };

function emit(name: string, n: number | null, ms: number[], extra: Record<string, unknown> = {}) {
  const sorted = [...ms].sort((a, b) => a - b);
  console.log(JSON.stringify({ side: 'web', name, n, ms: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, runs: ms.length, ...extra }));
}

/** Median of `repeat` fresh runs: `setup` builds what is measured on, `run` is timed. */
function measure<T>(name: string, n: number | null, setup: () => T, run: (s: T) => unknown, opts: { repeat?: number; teardown?: (s: T) => void } = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  const ms: number[] = [];
  let extra: Record<string, unknown> = {};
  for (let i = 0; i < (opts.repeat ?? REPEAT); i++) {
    const s = setup();
    const t0 = performance.now();
    const out = run(s) as { divide?: number } | undefined;
    ms.push((performance.now() - t0) / (out?.divide ?? 1));
    if (out && typeof out === 'object') extra = out as Record<string, unknown>;
    opts.teardown?.(s);
  }
  emit(name, n, ms, extra);
}

interface Session {
  board: TestBoard;
  ed: Editor;
  kid: string;
}

function session(fields = true): Session {
  const board = createTestBoard({ users: ['ann'], features });
  const [ed] = board.editors('card');
  const kid = ed.create({ type: 'kanban', x: 0, y: 0, w: 900, h: 320, title: 'Sprint', colW: 280, columns: COLUMNS, colorCards: true, ...(fields ? { fields: [PRIORITY, POINTS] } : {}) } as never);
  return { board, ed, kid };
}

/** A new card dropped into column `c` of the kanban (its center over the column, under the header). */
function cardIn(k: KanbanElement, c: number, i: number, frameId?: string) {
  const cx = k.x + kanbanColumnLeft(k, c) + k.colW / 2;
  return {
    type: 'card',
    x: cx - 130,
    y: k.y + KANBAN_LAYOUT.headerH + 60,
    w: 260,
    h: 90,
    title: `Card ${i}`,
    description: i % 2 ? '<p>Notes on what to do next</p>' : '',
    color: '#5B3FF0',
    status: COLUMNS[c].status,
    values: { f_prio: PRIORITY.options![i % 3].id, f_pts: i % 8 },
    ...(frameId ? { frameId } : {}),
  } as never;
}

/** A session whose kanban already holds `n` cards, laid out. */
function filled(n: number, settings: Partial<KanbanElement> = {}): Session {
  const s = session();
  const k = s.ed.getElement<KanbanElement>(s.kid)!;
  s.ed.transact(() => {
    s.ed.createMany(Array.from({ length: n }, (_, i) => cardIn(k, i % 3, i, s.kid)));
  });
  if (Object.keys(settings).length) s.ed.update<KanbanElement>(s.kid, settings);
  return s;
}

const done = (s: Session) => s.board.destroy();
const kanbanOf = (s: Session) => s.ed.getElement<KanbanElement>(s.kid)!;
const cardsOf = (s: Session) => s.ed.getElements().filter((el): el is CardElement => el.type === 'card' && el.frameId === s.kid);

// One structure makes at most LAYOUT_LIMITS.elements items (the CSV dialog reads that many rows).
const overLimit = { skip: `over the ${LAYOUT_LIMITS.elements - 1}-row limit` };

// ---- bulk creation into a kanban ----
for (const n of SIZES) {
  measure(
    'create one by one in one transaction (Editor.create × n)',
    n,
    () => session(),
    (s) => {
      const k = kanbanOf(s);
      s.ed.transact(() => {
        for (let i = 0; i < n; i++) s.ed.create(cardIn(k, i % 3, i));
      });
    },
    { teardown: done, repeat: n >= 5000 ? 1 : REPEAT },
  );
  measure(
    'createMany into a kanban (one call, frameId set: templates, createFromRows)',
    n,
    () => session(),
    (s) => {
      const k = kanbanOf(s);
      s.ed.transact(() => {
        s.ed.createMany(Array.from({ length: n }, (_, i) => cardIn(k, i % 3, i, s.kid)));
      });
    },
    { teardown: done },
  );
  measure(
    'createMany dropped onto a kanban (one call, no frameId: paste, drop)',
    n,
    () => session(),
    (s) => {
      const k = kanbanOf(s);
      s.ed.createMany(Array.from({ length: n }, (_, i) => cardIn(k, i % 3, i)));
    },
    { teardown: done },
  );
  measure(
    'loose cards, no kanban (baseline: Editor.create × n)',
    n,
    () => session(),
    (s) => {
      s.ed.transact(() => {
        for (let i = 0; i < n; i++) s.ed.create({ type: 'card', x: 5000 + (i % 40) * 300, y: Math.floor(i / 40) * 120, w: 260, h: 90, title: `Card ${i}`, description: '', color: '#5B3FF0', status: 'todo' } as never);
      });
    },
    { teardown: done, repeat: n >= 5000 ? 1 : REPEAT },
  );
  measure(
    'kanban.createFromRows (Convert to kanban)',
    n,
    () => createTestBoard({ users: ['ann'], features }),
    (board) => {
      const [ed] = board.editors('table');
      const rows = {
        title: 'Imported',
        columns: COLUMNS.map((c) => ({ title: c.title })),
        fields: [
          { name: 'Priority', type: 'select', options: [{ label: 'P0' }, { label: 'P1' }, { label: 'P2' }] },
          { name: 'Points', type: 'number' },
        ],
        cards: Array.from({ length: n }, (_, i) => ({ column: i % 3, text: `Row ${i}`, values: { Priority: `P${i % 3}`, Points: i % 8 } })),
      };
      ed.runCommand('kanban.createFromRows', { rows, at: { x: 0, y: 0 } });
      const made = ed.getElements().filter((el) => el.type === 'card').length;
      return made === n ? {} : n >= LAYOUT_LIMITS.elements ? overLimit : { note: `made ${made} of ${n}` };
    },
    { teardown: (b) => b.destroy() },
  );
  measure(
    'CSV import onto a new kanban with fields',
    n,
    () => {
      const header = ['Title', 'Stage', 'Priority', 'Points'];
      const body = Array.from({ length: n }, (_, i) => [`Row ${i}`, COLUMNS[i % 3].title, `P${i % 3}`, String(i % 8)]);
      const mapping = guessMapping(header);
      const columnsFrom = guessColumnsFrom(header)!;
      const rows = rowsToItems(body, { as: 'card', mapping, people: new Map() });
      const fields = fieldColumns(header, body, mapping, columnsFrom);
      return { board: createTestBoard({ users: ['ann'], features }), rows, fields, columnsFrom };
    },
    ({ board, rows, fields, columnsFrom }) => {
      const [ed] = board.editors('csv');
      try {
        placeRowsOnKanban(ed, rows, { columnsFrom, fields }, 'Imported');
      } catch (e) {
        return n >= LAYOUT_LIMITS.elements ? overLimit : { note: (e as Error).message.slice(0, 80) };
      }
      const made = ed.getElements().filter((el) => el.type === 'card').length;
      return made === n ? {} : { note: `made ${made} of ${n}` };
    },
    { teardown: (s) => s.board.destroy() },
  );
}

// ---- hot paths on a big kanban ----
const realistic: Partial<KanbanElement> = {
  // Swimlanes by Priority, a saved filter (Points ≥ 1) and a card limit on the first column.
  views: [{ id: 'board', name: 'Board', layout: 'board', subGroupBy: 'f_prio', filter: { op: 'and', rules: [{ field: 'f_pts', op: 'gt', value: 0 }] } } as never],
  activeView: 'board',
  columns: COLUMNS.map((c, i) => (i === 0 ? { ...c, limit: 50 } : c)),
} as Partial<KanbanElement>;

for (const [label, settings] of [
  ['plain', {}],
  ['swimlanes + filter + limit', realistic],
] as Array<[string, Partial<KanbanElement>]>) {
  const tag = `(${BIG} cards, ${label})`;
  measure(
    `move one card to another column ${tag}`,
    BIG,
    () => filled(BIG, settings),
    (s) => {
      const k = kanbanOf(s);
      const c = cardsOf(s).find((el) => el.status === 'todo')!;
      // A drop: one gesture, the card's center over the Done column.
      s.ed.beginGesture();
      s.ed.update<CardElement>(c.id, { x: k.x + kanbanColumnLeft(k, 2) + 10, y: k.y + KANBAN_LAYOUT.headerH + 80 });
      s.ed.endGesture();
      return s.ed.getElement<CardElement>(c.id)!.status === 'done' ? {} : { note: 'card did not take the status' };
    },
    { teardown: done },
  );
  measure(
    `re-lay: sort by Points ${tag}`,
    BIG,
    () => filled(BIG, settings),
    (s) => {
      s.ed.runCommand('kanban.setSort', { id: s.kid, sort: [{ field: 'f_pts', dir: 'desc' }] });
      return kanbanOf(s).views?.some((v) => (v as { sort?: unknown[] }).sort?.length) ? {} : { note: 'not sorted' };
    },
    { teardown: done },
  );
  measure(
    `re-lay: density compact (every card re-measured) ${tag}`,
    BIG,
    () => filled(BIG, settings),
    (s) => {
      const h = cardsOf(s).find((c) => c.description)!.h;
      s.ed.runCommand('kanban.setCardDisplay', { id: s.kid, density: 'compact' });
      return cardsOf(s).find((c) => c.description)!.h < h ? {} : { note: 'cards kept their height' };
    },
    { teardown: done },
  );
  measure(
    `re-lay: group by Priority ${tag}`,
    BIG,
    () => filled(BIG, settings),
    (s) => {
      s.ed.runCommand('kanban.groupBy', { id: s.kid, field: 'f_prio' });
      return kanbanOf(s).columns.some((c) => c.id === 'o_p0') ? {} : { note: 'not regrouped' };
    },
    { teardown: done },
  );
  measure(
    `unrelated edit: a sticky elsewhere ${tag}`,
    BIG,
    () => {
      const s = filled(BIG, settings);
      const sticky = s.ed.create({ type: 'sticky', x: 9000, y: 0, w: 200, h: 200, text: 'hi', color: '#FFD84D' } as never);
      return { ...s, sticky };
    },
    (s) => {
      // Ten edits, reported per edit.
      for (let i = 0; i < 10; i++) s.ed.update(s.sticky, { x: 9000 + i * 10 });
      return { per: 'edit', divide: 10 };
    },
    { teardown: done },
  );
  measure(
    `visible elements (hit tests, culling, marquee) ${tag}`,
    BIG,
    () => filled(BIG, settings),
    (s) => {
      for (let i = 0; i < 10; i++) {
        s.ed.update(s.kid, { title: `Sprint ${i}` }); // a change drops the caches, as on a live board
        s.ed.getVisibleElements();
      }
      return { per: 'call', divide: 10 };
    },
    { teardown: done },
  );
  measure(
    `outline (getOutline) ${tag}`,
    BIG,
    () => filled(BIG, settings),
    (s) => {
      s.ed.getOutline();
    },
    { teardown: done },
  );
}

// ---- a linked view of the big kanban (step 3c), drawn by react-dom in a jsdom page ----
// Opening it draws only the rows (days, bars) in view; one card changed re-renders that card's row
// alone (counted from the DOM mutations), not the view.
if (!ONLY || 'linked view'.includes(ONLY) || ONLY.includes('linked')) await linkedViews();

async function linkedViews() {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  for (const key of Object.getOwnPropertyNames(dom.window)) if (!(key in globalThis)) Object.defineProperty(globalThis, key, { configurable: true, get: () => (dom.window as unknown as Record<string, unknown>)[key] });
  // A production build (as the app ships): no act(); flushSync renders now, then effects settle.
  const { flushSync } = await import('react-dom');
  const { createRoot } = await import('react-dom/client');
  const settle = () => new Promise((r) => setTimeout(r, 30));
  for (const layout of ['table', 'calendar', 'timeline'] as const) {
    const s = filled(BIG);
    const k = kanbanOf(s);
    // Half of the cards dated over the next weeks, so a calendar and a timeline have something to place.
    s.ed.transact(() => cardsOf(s).forEach((c, i) => i % 2 === 0 && s.ed.update<CardElement>(c.id, { dueDate: `2026-11-${String(1 + (i % 28)).padStart(2, '0')}` })));
    s.ed.runCommand('kanban.addLinkedView', { id: k.id, layout });
    const lv = s.ed.getSelection()[0];
    s.ed.setCamera({ x: s.ed.getElement(lv)!.x - 40, y: -40, zoom: 1 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const t0 = performance.now();
    flushSync(() => root.render(s.board.element(0, lv)));
    const open = performance.now() - t0;
    await settle();
    const drawn = host.querySelectorAll('[role="row"], [data-card], [data-bar]').length;
    emit(`linked view, ${layout}: open (${BIG} cards)`, BIG, [open], { detail: `${drawn} rows / chips / bars drawn` });
    // One card on screen changed elsewhere (a collaborator renames it): what the view redraws.
    const chip = host.querySelector('[data-card], [data-bar]');
    const shownId = chip?.getAttribute('data-card') ?? chip?.getAttribute('data-bar');
    const shownTitle = host.querySelector('[role="rowheader"]')?.textContent;
    const target = cardsOf(s).find((c) => c.id === shownId || c.title === shownTitle)!;
    const changed = new Set<Element>();
    const watch = new MutationObserver((records) => {
      for (const r of records) {
        const el = (r.target.nodeType === 1 ? (r.target as Element) : r.target.parentElement)?.closest('[role="row"], [data-card], [data-bar]');
        if (el) changed.add(el);
      }
    });
    watch.observe(host, { subtree: true, childList: true, characterData: true, attributes: true });
    const t1 = performance.now();
    flushSync(() => void s.ed.update<CardElement>(target.id, { title: 'Renamed card' }));
    const update = performance.now() - t1;
    await settle();
    watch.disconnect();
    emit(`linked view, ${layout}: one card renamed by a collaborator (${BIG} cards)`, BIG, [update], { detail: `${changed.size} of them redrawn` });
    root.unmount();
    done(s);
  }
}

// Sanity: the board a bulk creation leaves is laid out (nothing left for a second pass).
{
  const s = filled(Math.min(BIG, 2000), realistic);
  const k = kanbanOf(s);
  const again = s.ed.getDefinition('kanban')!.arrange!(k as never, { editor: s.ed, touched: new Set(), previous: new Map() } as never);
  console.log(JSON.stringify({ side: 'web', name: 'check: laid out after bulk creation', n: null, ok: !again?.length }));
  done(s);
}
