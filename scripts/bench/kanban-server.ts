// The server side of the kanban benchmark (docs/design/kanban-fields-and-views.md §18), run by
// scripts/bench-kanban.mjs with tsx: the pure planning every server write to a kanban goes
// through — structure placement (`add_cards`, the API's insert, tracker imports: modules/structure
// planStructure, which ends in @freero/shared withKanbanLayout) and withKanbanLayout itself (an
// update_items on a big kanban). No database, no sockets: those don't grow with the cards.
// Prints one JSON line per measurement. Not a test.
import { KANBAN_LAYOUT, LAYOUT_LIMITS, kanbanColumnLeft, withKanbanLayout, type BoardElement, type CardElement, type FieldDef, type KanbanColumn, type KanbanElement } from '@freero/shared';
import { planStructure } from '../../apps/server/src/modules/structure/plan';
import type { BoardView } from '../../apps/server/src/modules/realtime/index';

const args = process.argv.slice(2);
const opt = (name: string, def: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const SIZES = opt('sizes', '500,1000,2000,5000').split(',').map(Number);
const BIG = Number(opt('big', '5000'));
const REPEAT = Number(opt('repeat', '3'));
const ONLY = opt('only', '');
const PER_CALL = 500; // API_MAX_ITEMS_PER_CALL: what one add_cards may carry

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
  console.log(JSON.stringify({ side: 'server', name, n, ms: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, runs: ms.length, ...extra }));
}

function measure<T>(name: string, n: number | null, setup: () => T, run: (s: T) => unknown) {
  if (ONLY && !name.includes(ONLY)) return;
  const ms: number[] = [];
  let extra: Record<string, unknown> = {};
  for (let i = 0; i < REPEAT; i++) {
    const s = setup();
    const t0 = performance.now();
    const out = run(s) as { divide?: number } | undefined;
    ms.push((performance.now() - t0) / (out?.divide ?? 1));
    if (out && typeof out === 'object') extra = out as Record<string, unknown>;
  }
  emit(name, n, ms, extra);
}

let seq = 0;
const newId = () => `id${++seq}`;

/** A board holding one kanban with `n` cards stacked in its columns (as a laid-out board stores them). */
function board(n: number, settings: Partial<KanbanElement> = {}): BoardElement[] {
  const k = { id: 'kb', type: 'kanban', x: 0, y: 0, w: 900, h: 320, z: 1, rotation: 0, title: 'Sprint', colW: 280, columns: COLUMNS, colorCards: true, fields: [PRIORITY, POINTS], ...settings } as unknown as KanbanElement;
  const cards: BoardElement[] = [];
  const y = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const c = i % 3;
    cards.push({
      id: `c${i}`,
      type: 'card',
      x: k.x + kanbanColumnLeft(k, c) + KANBAN_LAYOUT.pad,
      y: k.y + KANBAN_LAYOUT.headerH + KANBAN_LAYOUT.colHeadH + KANBAN_LAYOUT.pad + y[c],
      w: k.colW - 2 * KANBAN_LAYOUT.pad,
      h: 90,
      z: 2 + i / 10000,
      rotation: 0,
      frameId: k.id,
      title: `Card ${i}`,
      description: '',
      color: '#5B3FF0',
      status: COLUMNS[c].status,
      values: { f_prio: PRIORITY.options![i % 3].id, f_pts: i % 8 },
    } as unknown as CardElement);
    y[c] += 90 + KANBAN_LAYOUT.itemGap;
  }
  // Laid out once, as an open board would have left it.
  const laid = withKanbanLayout([k, ...cards], { update: [{ id: k.id, patch: {} }] });
  const patch = new Map(laid.update.map((u) => [u.id, u.patch]));
  return [k, ...cards].map((el) => (patch.has(el.id) ? ({ ...el, ...patch.get(el.id) } as BoardElement) : el));
}

const viewOf = (elements: BoardElement[]): BoardView => ({
  elements: elements.map((el) => ({ el, layer: 'shared' as const })),
  collection: () => new Map(),
  seesHidden: true,
  suggestions: [],
  version: 'bench',
});

const items = (n: number, from = 0) =>
  Array.from({ length: n }, (_, i) => ({ type: 'card' as const, text: `New ${from + i}`, status: COLUMNS[(from + i) % 3].status, fields: { Priority: `P${(from + i) % 3}`, Points: (from + i) % 8 } }));

for (const n of SIZES) {
  // An import of n cards into an empty kanban, in add_cards-sized calls (each planned on the board the last one left).
  measure(`add_cards into an empty kanban, ${PER_CALL} per call`, n, () => board(0), (start) => {
    let elements = start;
    for (let done = 0; done < n; done += PER_CALL) {
      const plan = planStructure({ structure: { kind: 'items', items: items(Math.min(PER_CALL, n - done), done) }, placement: { into: 'kb' } }, viewOf(elements), newId);
      const patch = new Map((plan.change.update ?? []).map((u) => [u.id, u.patch]));
      elements = [
        ...elements.map((el) => (patch.has(el.id) ? ({ ...el, ...patch.get(el.id) } as BoardElement) : el)),
        ...(plan.change.create ?? []).map((d) => ({ z: 0, rotation: 0, ...d }) as unknown as BoardElement),
      ];
    }
    const cards = elements.filter((el) => el.type === 'card').length;
    return cards === n ? {} : { note: `made ${cards} of ${n}` };
  });
  // One call's worth onto a kanban that already holds n cards.
  measure(`add_cards ${PER_CALL} cards into a kanban holding n`, n, () => board(n), (elements) => {
    planStructure({ structure: { kind: 'items', items: items(PER_CALL) }, placement: { into: 'kb' } }, viewOf(elements), newId);
  });
  // A new kanban of n cards in one structure (the layout's own limit applies).
  measure('new kanban of n cards (add_cards columns / newKanban)', n, () => board(0), (elements) => {
    try {
      const plain = items(n).map(({ fields: _f, ...it }) => it);
      planStructure({ structure: { kind: 'items', items: plain, layout: 'kanban', title: 'Imported' } }, viewOf(elements), newId);
    } catch (e) {
      // One structure makes at most LAYOUT_LIMITS.elements items (a bigger import is several calls).
      if (n >= LAYOUT_LIMITS.elements) return { skip: `over the ${LAYOUT_LIMITS.elements - 1}-item limit of one structure` };
      return { note: (e as Error).message.slice(0, 80) };
    }
    return {};
  });
}

const realistic: Partial<KanbanElement> = {
  views: [{ id: 'board', name: 'Board', layout: 'board', subGroupBy: 'f_prio', filter: { op: 'and', rules: [{ field: 'f_pts', op: 'gt', value: 0 }] } } as never],
  activeView: 'board',
  columns: COLUMNS.map((c, i) => (i === 0 ? { ...c, limit: 50 } : c)),
} as Partial<KanbanElement>;

for (const [label, settings] of [
  ['plain', {}],
  ['swimlanes + filter + limit', realistic],
] as Array<[string, Partial<KanbanElement>]>) {
  const tag = `(${BIG} cards, ${label})`;
  measure(`update_items: one card to another column, laid out ${tag}`, BIG, () => board(BIG, settings), (elements) => {
    // What update_items sends for a new Stage: the card moved over that column (modules/api items.ts).
    const k = elements[0] as KanbanElement;
    const out = withKanbanLayout(elements, { update: [{ id: 'c0', patch: { x: k.x + kanbanColumnLeft(k, 2) + KANBAN_LAYOUT.pad } }] });
    return out.update.find((u) => u.id === 'c0')?.patch.status === 'done' ? {} : { note: 'card did not take the status' };
  });
  measure(`re-lay the whole kanban (configure_view) ${tag}`, BIG, () => board(BIG, settings), (elements) => {
    withKanbanLayout(elements, { update: [{ id: 'kb', patch: { colW: 300 } }] });
  });
}
