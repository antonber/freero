// Mermaid class, entity-relationship and state diagrams (#38), read in-house like the rest of the
// Mermaid subset (mermaid.ts): the parts that map onto board elements become the shape library's
// own UML / ERD shapes and line ends — a class is a `umlClass` with compartments, an entity an
// `erdEntity` table, relations connectors with UML / crow's-foot caps, composite states and
// namespaces frames. Styling directives are skipped; anything else unknown is an error naming the
// line, so nothing is silently dropped.
import type { CapStyle } from '../elements';
import { escapeHtml } from '../text';
import { INK } from './kit';
import { measureText } from './measure';
import type { DiagramEdge, DiagramNode } from './structures';
import type { Direction, GraphGroupInput } from './types';
import { LAYOUT_LIMITS, LayoutError } from './types';

export interface UmlDiagram {
  kind: 'class' | 'er' | 'state';
  direction: Direction;
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  groups: GraphGroupInput[];
}

export interface Statement {
  text: string;
  line: number;
}

const fail = (line: number, msg: string): never => {
  throw new LayoutError(`Mermaid line ${line}: ${msg}`);
};

/** Directives that only style the drawing (the board has its own styles). */
const STYLING = /^(?:style|classDef|cssClass|click|link|callback|accTitle|accDescr|hide|show|scale|skinparam)\b|^class\s+[\w,-]+\s+[\w-]+$/;

const unquote = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};

const DIRECTION = /^direction\s+(TB|TD|BT|LR|RL)$/i;
const directionOf = (d: string): Direction => {
  const u = d.toUpperCase();
  return u === 'TD' ? 'TB' : (u as Direction);
};

// ------------------------------------------------------------------------------- box measures

/**
 * The web draws class and entity boxes as tables: text 14px at line height 1.7 inside 10px of
 * padding (features/shape ENTITY_FONT / ENTITY_LINE / ENTITY_PAD), the dividers between lines.
 * Boxes are sized here to hold every line unwrapped.
 */
export const TABLE_FONT = 14;
const TABLE_LINE = TABLE_FONT * 1.7;
const TABLE_PAD = 10;
const STROKE = 2;

export function tableSize(lines: Array<{ text: string; bold?: boolean }>, extra = 0): { w: number; h: number } {
  const widest = Math.max(...lines.map((l) => measureText(l.text || ' ', { fontSize: TABLE_FONT, maxWidth: 100_000, bold: l.bold }).w));
  return {
    w: Math.round(Math.min(560, Math.max(160, widest + 2 * TABLE_PAD + STROKE + 16))),
    h: Math.round(2 * TABLE_PAD + STROKE + lines.length * TABLE_LINE + 2 + extra),
  };
}

const clipText = (s: string) => (s.length > LAYOUT_LIMITS.text ? s.slice(0, LAYOUT_LIMITS.text) : s);

function checkCount(n: number, what: string) {
  if (n > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} ${what} per diagram`);
}

// ------------------------------------------------------------------------------- class diagrams

interface ClassBox {
  id: string;
  label: string;
  annotation?: string;
  members: string[];
  namespace?: string;
}

/**
 * `Animal~T~` → `Animal<T>`, `List~List~int~~` → `List<List<int>>` (Mermaid writes generics between
 * tildes): a tilde before a letter opens one, any other closes it.
 */
const generic = (s: string) => s.replace(/~/g, (_t: string, i: number) => (/[\w$À-￿]/.test(s[i + 1] ?? '') ? '<' : '>'));

/** One member as UML writes it: `deposit(amount) bool` → `deposit(amount) : bool`; `$` static, `*` abstract. */
function memberHtml(raw: string): { html: string; plain: string } {
  let t = generic(raw.trim());
  let mark: 'static' | 'abstract' | null = null;
  if (/[$*]$/.test(t)) {
    mark = t.endsWith('$') ? 'static' : 'abstract';
    t = t.slice(0, -1).trimEnd();
  }
  const op = /^(.*\))\s*([$*])?\s*(.*)$/.exec(t);
  if (op && t.includes('(')) {
    if (op[2]) mark = op[2] === '$' ? 'static' : 'abstract';
    t = op[3] ? `${op[1]} : ${op[3]}` : op[1];
  }
  const html = escapeHtml(t);
  return { html: mark === 'static' ? `<u>${html}</u>` : mark === 'abstract' ? `<i>${html}</i>` : html, plain: t };
}

const CLASS_NAME = String.raw`[A-Za-z_À-￿][\w$À-￿.]*(?:~[^~]+~)?|\x60[^\x60]+\x60`;
const CLASS_RE = new RegExp(String.raw`^class\s+(${CLASS_NAME})(?:\s*\["([^"]*)"\])?\s*(?::::[\w-]+)?\s*(\{.*)?$`);
const MEMBER_RE = new RegExp(String.raw`^(${CLASS_NAME})\s*:\s*(.+)$`);
const ANNOTATION_RE = new RegExp(String.raw`^<<\s*([^>]+?)\s*>>\s*(${CLASS_NAME})?$`);
/** `A "1" <|-- "many" B : label` — ends: `<|` `*` `o` `<` … `|>` `*` `o` `>`; body `--` solid, `..` dashed. */
const RELATION_RE = new RegExp(
  String.raw`^(${CLASS_NAME})\s*(?:"([^"]*)")?\s*(<\||\*|o|<)?(--|\.\.)(\|>|\*|o|>)?\s*(?:"([^"]*)")?\s*(${CLASS_NAME})\s*(?::\s*(.*))?$`,
);

const CLASS_CAP: Record<string, CapStyle> = { '<|': 'triangleOpen', '|>': 'triangleOpen', '*': 'diamond', o: 'diamondOpen', '<': 'arrow', '>': 'arrow' };

/** A class's id: its name without backticks or generic part (relations name `Square`, not `Square~Shape~`). */
const plainName = (s: string) => (s.startsWith('`') && s.endsWith('`') ? s.slice(1, -1) : s.replace(/~[^~]+~$/, ''));

export function parseClassDiagram(stmts: Statement[]): UmlDiagram {
  const classes = new Map<string, ClassBox>();
  const edges: DiagramEdge[] = [];
  const groups: GraphGroupInput[] = [];
  const notes: Array<{ id: string; text: string; for?: string; line: number }> = [];
  let direction: Direction = 'TB';
  let namespace: string | undefined;
  let open: { box: ClassBox; line: number } | null = null;

  const ensure = (rawName: string, line: number): ClassBox => {
    const id = plainName(rawName);
    let c = classes.get(id);
    if (!c) {
      checkCount(classes.size + 1, 'classes');
      c = { id, label: id, members: [], ...(namespace ? { namespace } : {}) };
      classes.set(id, c);
    } else if (namespace && !c.namespace) c.namespace = namespace;
    if (/~[^~]+~$/.test(rawName)) c.label = rawName;
    if (!id) fail(line, 'a class needs a name');
    return c;
  };

  for (const { text, line } of stmts) {
    if (open) {
      if (text === '}') {
        open = null;
        continue;
      }
      const ann = /^<<\s*([^>]+?)\s*>>$/.exec(text);
      if (ann) open.box.annotation = ann[1];
      else open.box.members.push(text);
      continue;
    }
    if (STYLING.test(text)) continue;
    const dir = DIRECTION.exec(text);
    if (dir) {
      direction = directionOf(dir[1]);
      continue;
    }
    const ns = /^namespace\s+([\w.-]+)\s*\{$/.exec(text);
    if (ns) {
      if (namespace) fail(line, 'namespaces do not nest');
      namespace = ns[1];
      if (!groups.some((g) => g.id === `ns:${namespace}`)) groups.push({ id: `ns:${namespace}`, title: namespace, nodes: [] });
      continue;
    }
    if (text === '}') {
      if (!namespace) fail(line, '"}" without a class or namespace');
      namespace = undefined;
      continue;
    }
    const note = /^note\s+(?:for\s+(\S+)\s+)?"(.*)"$/.exec(text);
    if (note) {
      notes.push({ id: `note:${notes.length + 1}`, text: note[2].replace(/\\n|<br\s*\/?>/gi, '\n'), ...(note[1] ? { for: plainName(note[1]) } : {}), line });
      continue;
    }
    const cls = CLASS_RE.exec(text);
    if (cls) {
      const box = ensure(cls[1], line);
      if (cls[2] !== undefined) box.label = cls[2];
      const body = cls[3];
      if (body) {
        const inner = body.slice(1).trim();
        if (inner.endsWith('}')) {
          for (const m of inner.slice(0, -1).split(/\s{2,}|;/).map((s) => s.trim()).filter(Boolean)) box.members.push(m);
        } else {
          if (inner) box.members.push(inner);
          open = { box, line };
        }
      }
      continue;
    }
    const ann = ANNOTATION_RE.exec(text);
    if (ann) {
      if (!ann[2]) fail(line, `which class is <<${ann[1]}>>? Write "<<${ann[1]}>> ClassName"`);
      ensure(ann[2]!, line).annotation = ann[1];
      continue;
    }
    const rel = RELATION_RE.exec(text);
    if (rel) {
      const [, a, aCard, left, body, right, bCard, b, label] = rel;
      const from = ensure(a, line);
      const to = ensure(b, line);
      checkCount(edges.length + 1, 'relations');
      edges.push({
        from: from.id,
        to: to.id,
        style: body === '..' ? 'dashed' : 'solid',
        startCap: left ? CLASS_CAP[left] : 'none',
        endCap: right ? CLASS_CAP[right] : 'none',
        ...(label?.trim() ? { label: unquote(label) } : {}),
        ...(aCard ? { startLabel: aCard } : {}),
        ...(bCard ? { endLabel: bCard } : {}),
      });
      continue;
    }
    const member = MEMBER_RE.exec(text);
    if (member) {
      const m = member[2].trim();
      const ann2 = /^<<\s*([^>]+?)\s*>>$/.exec(m);
      if (ann2) ensure(member[1], line).annotation = ann2[1];
      else ensure(member[1], line).members.push(m);
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  if (open) fail(open.line, `class "${open.box.id}" has no closing "}"`);
  if (namespace) throw new LayoutError(`Mermaid: namespace "${namespace}" has no closing "}"`);
  if (!classes.size) throw new LayoutError('The class diagram has no classes');

  const nodes: DiagramNode[] = [];
  for (const c of classes.values()) {
    const members = c.members.map(memberHtml);
    const attrs = members.filter((m) => !m.plain.includes('('));
    const ops = members.filter((m) => m.plain.includes('('));
    const name = `${c.annotation ? `«${c.annotation}» ` : ''}${generic(c.label)}`;
    // Every class shows its three compartments: an empty attribute one keeps a blank line, so the
    // operations' divider never sits on the name's.
    const attrLines = attrs.length ? attrs : [{ html: '', plain: '' }];
    const lines = [{ text: name, bold: true }, ...attrLines.map((m) => ({ text: m.plain })), ...ops.map((m) => ({ text: m.plain }))];
    const html = [`<b>${escapeHtml(name)}</b>`, ...attrLines.map((m) => m.html), ...ops.map((m) => m.html)].join('<br>');
    nodes.push({
      id: c.id,
      text: name,
      shape: 'umlClass',
      size: tableSize(lines, ops.length ? 0 : 14),
      look: { text: clipText(html), compartments: true, fontSize: TABLE_FONT, align: 'left', vAlign: 'top' },
    });
    if (c.namespace) groups.find((g) => g.id === `ns:${c.namespace}`)!.nodes.push(c.id);
  }
  for (const n of notes) {
    if (n.for && !classes.has(n.for)) fail(n.line, `the note is for "${n.for}", which is not a class here`);
    nodes.push(noteNode(n.id, n.text));
    if (n.for) edges.push({ from: n.id, to: n.for, style: 'dashed', arrow: 'none' });
  }
  return { kind: 'class', direction, nodes, edges, groups: groups.filter((g) => g.nodes.length) };
}

export function noteNode(id: string, text: string): DiagramNode {
  const m = measureText(text || ' ', { fontSize: 14, maxWidth: 240, lineHeight: 1.4 });
  return {
    id,
    text,
    shape: 'umlNote',
    size: { w: Math.round(Math.max(140, m.w + 48)), h: Math.round(Math.max(60, m.h + 32)) },
    look: { fill: '#FFF6D6', fontSize: 14 },
  };
}

// ------------------------------------------------------------------------------- ER diagrams

/** Crow's-foot ends as Mermaid writes them on each side of the line. */
function erCap(token: string): CapStyle {
  const zero = token.includes('o');
  const many = token.includes('{') || token.includes('}');
  if (many) return zero ? 'zeroOrMany' : 'oneOrMany';
  return zero ? 'zeroOrOne' : 'one';
}

const ER_NAME = String.raw`"[^"]+"|[A-Za-z_À-￿][\w\-À-￿]*`;
const ER_SIDE = String.raw`\|o|o\||\|\||\}o|o\{|\}\||\|\{`;
const ER_REL_RE = new RegExp(String.raw`^(${ER_NAME})\s*(${ER_SIDE})(--|\.\.|\.-|-\.)(${ER_SIDE})\s*(${ER_NAME})\s*(?::\s*(.*))?$`);
const ER_ENTITY_RE = new RegExp(String.raw`^(${ER_NAME})(?:\s*\[\s*("[^"]*"|[^\]]*)\s*\])?\s*(\{.*)?$`);
/** `type name PK, FK "comment"` (type may hold generics / arrays: `varchar(255)`, `string[]`). */
const ER_ATTR_RE = /^([\w\-()[\],~]+)\s+([\w\-()[\]*]+)(?:\s+((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?$/;

export function parseErDiagram(stmts: Statement[]): UmlDiagram {
  const entities = new Map<string, { id: string; label: string; attrs: Array<{ type: string; name: string; keys: string; comment: string }> }>();
  const edges: DiagramEdge[] = [];
  let direction: Direction = 'TB';
  let open: { id: string; line: number } | null = null;
  const ensure = (raw: string) => {
    const id = unquote(raw);
    let e = entities.get(id);
    if (!e) {
      checkCount(entities.size + 1, 'entities');
      e = { id, label: id, attrs: [] };
      entities.set(id, e);
    }
    return e;
  };
  for (const { text, line } of stmts) {
    if (open) {
      if (text === '}') {
        open = null;
        continue;
      }
      const a = ER_ATTR_RE.exec(text);
      if (!a) fail(line, `can't read the attribute "${text.slice(0, 40)}" (write: type name PK "comment")`);
      entities.get(open.id)!.attrs.push({ type: a![1], name: a![2], keys: (a![3] ?? '').replace(/\s+/g, ''), comment: a![4] ?? '' });
      continue;
    }
    if (STYLING.test(text)) continue;
    const dir = DIRECTION.exec(text);
    if (dir) {
      direction = directionOf(dir[1]);
      continue;
    }
    const rel = ER_REL_RE.exec(text);
    if (rel) {
      const [, a, left, body, right, b, label] = rel;
      const from = ensure(a);
      const to = ensure(b);
      checkCount(edges.length + 1, 'relationships');
      edges.push({
        from: from.id,
        to: to.id,
        style: body === '--' ? 'solid' : 'dashed',
        startCap: erCap(left),
        endCap: erCap(right),
        ...(label && unquote(label) ? { label: unquote(label) } : {}),
      });
      continue;
    }
    const ent = ER_ENTITY_RE.exec(text);
    if (ent) {
      const e = ensure(ent[1]);
      if (ent[2]) e.label = unquote(ent[2]);
      const body = ent[3]?.slice(1).trim();
      if (body !== undefined) {
        if (body === '}') continue;
        if (body) fail(line, 'put each attribute on its own line');
        open = { id: e.id, line };
      }
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}" (a relationship looks like: CUSTOMER ||--o{ ORDER : places)`);
  }
  if (open) fail(open.line, `entity "${open.id}" has no closing "}"`);
  if (!entities.size) throw new LayoutError('The ER diagram has no entities');
  const nodes: DiagramNode[] = [...entities.values()].map((e) => {
    const rows = e.attrs.map((a) => {
      const keys = a.keys ? `${a.keys.replace(/,/g, ', ')} ` : '';
      const plain = `${keys}${a.name}: ${a.type}${a.comment ? ` — ${a.comment}` : ''}`;
      const html = `${a.keys ? `${escapeHtml(a.keys.replace(/,/g, ', '))}&nbsp; ` : ''}${escapeHtml(a.name)}: ${escapeHtml(a.type)}${a.comment ? ` <i>— ${escapeHtml(a.comment)}</i>` : ''}`;
      return { plain, html };
    });
    return {
      id: e.id,
      text: e.label,
      shape: 'erdEntity',
      size: tableSize([{ text: e.label, bold: true }, ...rows.map((r) => ({ text: r.plain }))], rows.length ? 0 : 8),
      look: { text: clipText([`<b>${escapeHtml(e.label)}</b>`, ...rows.map((r) => r.html)].join('<br>')), fontSize: TABLE_FONT, align: 'left', vAlign: 'top' },
    };
  });
  return { kind: 'er', direction, nodes, edges, groups: [] };
}

// ------------------------------------------------------------------------------- state diagrams

const STATE_ID = String.raw`\[\*\]|[A-Za-z_À-￿][\w\-.À-￿]*`;
const TRANSITION_RE = new RegExp(String.raw`^(${STATE_ID})\s*-->\s*(${STATE_ID})\s*(?::\s*(.*))?$`);

export function parseStateDiagram(stmts: Statement[]): UmlDiagram {
  interface State {
    id: string;
    label: string;
    descriptions: string[];
    kind: 'state' | 'start' | 'end' | 'choice' | 'fork' | 'join';
    scope: string | null;
  }
  const states = new Map<string, State>();
  const composites = new Map<string, GraphGroupInput>();
  const edges: DiagramEdge[] = [];
  const notes: Array<{ id: string; text: string; for: string }> = [];
  let direction: Direction = 'TB';
  const stack: string[] = [];
  let openNote: { for: string; lines: string[]; line: number } | null = null;
  const scope = () => stack[stack.length - 1] ?? null;
  const ensure = (id: string, line: number, as: 'from' | 'to' | 'decl' = 'decl'): string => {
    if (id === '[*]') {
      // A scope's [*] is its start when a line leaves it, its end when a line arrives.
      const kind = as === 'to' ? 'end' : 'start';
      const key = `[*]${kind}:${scope() ?? ''}`;
      if (!states.has(key)) states.set(key, { id: key, label: '', descriptions: [], kind, scope: scope() });
      return key;
    }
    if (composites.has(id)) return id;
    if (!states.has(id)) {
      checkCount(states.size + composites.size + 1, 'states');
      states.set(id, { id, label: id, descriptions: [], kind: 'state', scope: scope() });
    }
    if (!id) fail(line, 'a state needs a name');
    return id;
  };
  for (const { text, line } of stmts) {
    if (openNote) {
      if (/^end\s+note$/i.test(text)) {
        notes.push({ id: `note:${notes.length + 1}`, text: openNote.lines.join('\n'), for: openNote.for });
        openNote = null;
      } else openNote.lines.push(text);
      continue;
    }
    if (STYLING.test(text) || text === '--') continue; // `--` splits a composite into concurrent regions: drawn together
    const dir = DIRECTION.exec(text);
    if (dir) {
      if (!stack.length) direction = directionOf(dir[1]);
      continue;
    }
    if (text === '}') {
      if (!stack.pop()) fail(line, '"}" without a composite state');
      continue;
    }
    const composite = /^state\s+(?:"([^"]*)"\s+as\s+)?([\w\-.À-￿]+)\s*\{$/.exec(text);
    if (composite) {
      const id = composite[2];
      if (composites.has(id)) fail(line, `composite state "${id}" is declared twice`);
      // Named in a transition before its block: that was the composite, not a simple state.
      const was = states.get(id);
      if (was && was.kind === 'state') states.delete(id);
      checkCount(states.size + composites.size + 1, 'states');
      composites.set(id, { id, title: composite[1] ?? was?.label ?? id, nodes: [], parent: scope() });
      stack.push(id);
      continue;
    }
    const special = /^state\s+([\w\-.À-￿]+)\s*<<\s*(choice|fork|join)\s*>>$/.exec(text);
    if (special) {
      const s = states.get(ensure(special[1], line))!;
      s.kind = special[2] as State['kind'];
      continue;
    }
    const alias = /^state\s+"([^"]*)"\s+as\s+([\w\-.À-￿]+)$/.exec(text) ?? /^state\s+([\w\-.À-￿]+)\s+as\s+"([^"]*)"$/.exec(text);
    if (alias) {
      const quotedFirst = text.startsWith('state "');
      const id = quotedFirst ? alias[2] : alias[1];
      const label = quotedFirst ? alias[1] : alias[2];
      states.get(ensure(id, line))!.label = label;
      continue;
    }
    const plain = /^state\s+([\w\-.À-￿]+)$/.exec(text);
    if (plain) {
      ensure(plain[1], line);
      continue;
    }
    const noteLine = /^note\s+(?:left|right)\s+of\s+([\w\-.À-￿]+)\s*:\s*(.*)$/i.exec(text);
    if (noteLine) {
      notes.push({ id: `note:${notes.length + 1}`, text: noteLine[2], for: ensure(noteLine[1], line) });
      continue;
    }
    const noteBlock = /^note\s+(?:left|right)\s+of\s+([\w\-.À-￿]+)$/i.exec(text);
    if (noteBlock) {
      openNote = { for: ensure(noteBlock[1], line), lines: [], line };
      continue;
    }
    const tr = TRANSITION_RE.exec(text);
    if (tr) {
      const from = ensure(tr[1], line, 'from');
      const to = ensure(tr[2], line, 'to');
      checkCount(edges.length + 1, 'transitions');
      edges.push({ from, to, arrow: 'forward', ...(tr[3]?.trim() ? { label: tr[3].trim() } : {}) });
      continue;
    }
    const desc = /^([\w\-.À-￿]+)\s*:\s*(.+)$/.exec(text);
    if (desc) {
      const id = ensure(desc[1], line);
      if (composites.has(id)) composites.get(id)!.title = `${composites.get(id)!.title}: ${desc[2].trim()}`;
      else states.get(id)!.descriptions.push(desc[2].trim());
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  if (openNote) fail(openNote.line, 'the note has no "end note"');
  if (stack.length) throw new LayoutError(`Mermaid: composite state "${stack[stack.length - 1]}" has no closing "}"`);
  if (!states.size && !composites.size) throw new LayoutError('The state diagram has no states');

  const across = direction === 'LR' || direction === 'RL';
  const nodes: DiagramNode[] = [];
  for (const s of states.values()) {
    if (s.scope) composites.get(s.scope)!.nodes.push(s.id);
    if (s.kind === 'start') nodes.push({ id: s.id, text: '', shape: 'ellipse', size: { w: 28, h: 28 }, look: { fill: INK, stroke: INK } });
    else if (s.kind === 'end') nodes.push({ id: s.id, text: '', shape: 'bpmnEnd', size: { w: 34, h: 34 }, look: { fill: 'transparent', stroke: INK } });
    else if (s.kind === 'choice') nodes.push({ id: s.id, text: '', shape: 'diamond', size: { w: 44, h: 44 } });
    else if (s.kind === 'fork' || s.kind === 'join')
      nodes.push({ id: s.id, text: '', shape: 'rect', size: across ? { w: 10, h: 96 } : { w: 96, h: 10 }, look: { fill: INK, stroke: INK } });
    else {
      const text = [s.label, ...s.descriptions].join('\n');
      nodes.push({ id: s.id, text, shape: 'roundRect' });
    }
  }
  for (const n of notes) {
    nodes.push(noteNode(n.id, n.text));
    const target = states.get(n.for);
    if (target?.scope) composites.get(target.scope)!.nodes.push(n.id);
    edges.push({ from: n.id, to: n.for, style: 'dashed', arrow: 'none' });
  }
  return { kind: 'state', direction, nodes, edges, groups: [...composites.values()] };
}
