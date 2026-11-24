// The names a caller may use in a structure besides the documented ones (#93). Agents know the MCP
// add_ tools' arguments (`stickies`, `cards`, `mermaid`, `outline`, a card's `title` …) and name a
// kind's content after the kind; both read as the documented field, so a first call isn't refused
// for a synonym. A documented field that is given always wins. Pure renaming: whether the content is
// any good stays `layoutStructure`'s to say.
import type { StructureInput } from './types';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** Every kind: the list agents are given. */
export const STRUCTURE_KINDS = [
  'stickies',
  'clusters',
  'kanban',
  'items',
  'note',
  'table',
  'chart',
  'mermaid',
  'plantuml',
  'sequence',
  'mindmap',
  'tree',
  'outline',
  'orgchart',
  'graph',
  'meeting',
] as const satisfies ReadonlyArray<StructureInput['kind']>;

/** Kind → its content's field, then the names it goes by besides the kind's own. */
const CONTENT: Record<string, readonly [field: string, ...also: string[]]> = {
  stickies: ['items'],
  kanban: ['columns'],
  items: ['items', 'cards'],
  note: ['text'],
  table: ['rows'],
  mermaid: ['source'],
  plantuml: ['source'],
  meeting: ['source'],
  sequence: ['diagram'],
  mindmap: ['root', 'outline'],
  tree: ['root', 'outline'],
  outline: ['text'],
  orgchart: ['people'],
};

/** `o` with `to` taken from the first of `from` it has (never over a `to` that is given). */
function renamed(o: Obj, to: string, ...from: string[]): Obj {
  if (o[to] !== undefined) return o;
  const name = from.find((f) => f !== to && o[f] !== undefined);
  if (!name) return o;
  const { [name]: value, ...rest } = o;
  return { ...rest, [to]: value };
}

const each = (v: unknown, f: (o: Obj) => Obj): unknown => (Array.isArray(v) ? v.map((x) => (isObj(x) ? f(x) : x)) : v);
/** A card as add_cards has it. */
const card = (o: Obj): Obj => renamed(o, 'text', 'title');

/** `input` with its content under the documented names. */
export function readStructure(input: unknown): StructureInput {
  if (!isObj(input) || typeof input.kind !== 'string') return input as StructureInput;
  const { kind } = input;
  let s: Obj = input;
  // A graph or chart may come whole under its own name, as add_diagram takes it.
  if ((kind === 'graph' || kind === 'chart') && isObj(s[kind])) {
    const { [kind]: whole, ...rest } = s;
    s = { ...(whole as Obj), ...rest };
  }
  // `cards` are cards: they need no type each.
  if (kind === 'items' && s.items === undefined && Array.isArray(s.cards))
    s = { ...s, cards: s.cards.map((c: unknown) => (isObj(c) ? { type: 'card', ...c } : typeof c === 'string' ? { type: 'card', text: c } : c)) };
  if (Object.hasOwn(CONTENT, kind)) {
    const [field, ...also] = CONTENT[kind];
    s = renamed(s, field, kind, ...also);
  }
  if (kind === 'kanban')
    s = {
      ...s,
      columns: each(s.columns, (c) => {
        const column = renamed(c, 'items', 'cards');
        return { ...column, items: each(column.items, card) };
      }),
    };
  if (kind === 'items') s = { ...s, items: each(s.items, card) };
  if (kind === 'graph') s = { ...s, nodes: each(s.nodes, (n) => renamed(n, 'text', 'label')) };
  return s as unknown as StructureInput;
}
