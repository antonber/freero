// A PlantUML reader (#38) for the subset that maps onto board elements: sequence, class, activity
// (the current syntax, and `(*)` arrows of the old one), state, use case and component
// diagrams. Written in-house from the language's documented syntax; nothing of PlantUML's code is
// used and no file is ever fetched (`!include` is refused). Like the Mermaid reader it produces
// the diagram model the layouts take — a sequence (`layoutSequence`), or nodes, edges and groups
// with their own sizes, looks and UML line ends (the class / ER / state model of uml.ts) — so a
// PlantUML diagram lands as the same shapes a Mermaid one does. Styling (skinparam, colours,
// themes, titles, legends) is skipped; anything else unknown is an error naming the line.
import type { CapStyle, ShapeKind } from '../elements';
import { escapeHtml } from '../text';
import { INK } from './kit';
import { measureText } from './measure';
import { layoutDiagram, layoutSequence, type DiagramEdge, type DiagramNode } from './structures';
import { noteNode, TABLE_FONT, tableSize } from './uml';
import type { Direction, GraphGroupInput, LaidOut, LayoutContext, SequenceInput } from './types';
import { LAYOUT_LIMITS, LayoutError } from './types';

/** Nodes and edges of the diagram model the layouts share with Mermaid's class / ER / state diagrams. */
export type PlantNode = DiagramNode;
export type PlantEdge = DiagramEdge;

export type PlantUmlDiagram =
  | { kind: 'sequence'; diagram: SequenceInput }
  | { kind: 'class' | 'state' | 'activity' | 'description'; direction: Direction; nodes: PlantNode[]; edges: PlantEdge[]; groups: GraphGroupInput[] };

interface Stmt {
  text: string;
  line: number;
}

const fail = (line: number, msg: string): never => {
  throw new LayoutError(`PlantUML line ${line}: ${msg}`);
};

/** `@startuml` alone on its first line (after blank lines and comments): text the board reads as PlantUML. */
export const looksLikePlantUml = (text: string | null | undefined): boolean => !!text && /^\s*(?:'[^\n]*\n\s*)*@startuml\b[^\n]*(?:\r?\n|$)/i.test(text);

const unquote = (s: string) => {
  const t = s.trim();
  return t.length >= 2 && t.startsWith('"') && t.endsWith('"') ? t.slice(1, -1) : t;
};
/** Label text: `\n` and `<br>` break lines; Creole bold / italic markers and HTML-ish tags are dropped. */
const label = (s: string) =>
  unquote(s)
    .replace(/\\n|<br\s*\/?>/gi, '\n')
    .replace(/<\/?(?:b|i|u|s|font|color|size|back)[^>]*>/gi, '')
    .replace(/\*\*(.+?)\*\*|\/\/(.+?)\/\/|__(.+?)__/g, (_m, a, b, c) => a ?? b ?? c)
    .trim();
const clip = (s: string) => (s.length > LAYOUT_LIMITS.text ? s.slice(0, LAYOUT_LIMITS.text) : s);
const count = (n: number) => {
  if (n > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} items per diagram`);
};

// ------------------------------------------------------------------------------- statements

/** Styling and page furniture: nothing on the board stands for them. */
const SKIPPED = /^(?:skinparam|scale|hide|show|caption|header|footer|autonumber|newpage|allowmixing|allow_mixing|set\s|mainframe|skin\b|!theme|!pragma|remove|restore|page\s|left\s+to\s+right\s+direction|top\s+to\s+bottom\s+direction|hide\s+footbox|legend\s+(?:left|right|top|bottom|center).*\bendlegend$)/i;
/** Blocks skipped up to their end line. */
const BLOCKS: Array<[RegExp, RegExp]> = [
  [/^skinparam\b.*\{$/i, /^\}$/],
  [/^<style>/i, /^<\/style>$/i],
  [/^legend\b/i, /^end\s*legend$/i],
  [/^(?:header|footer)$/i, /^end\s*(?:header|footer)$/i],
  [/^title$/i, /^end\s*title$/i],
];

function statements(source: string): { stmts: Stmt[]; direction: Direction; title?: string } {
  if (typeof source !== 'string' || !source.trim()) throw new LayoutError('The PlantUML source is empty');
  if (source.length > LAYOUT_LIMITS.source) throw new LayoutError(`PlantUML source is longer than ${LAYOUT_LIMITS.source} characters`);
  const lines = source.split(/\r\n?|\n/);
  let i = 0;
  let started = false;
  const startAt = lines.findIndex((l) => /^\s*@start\w*/i.test(l));
  if (startAt >= 0) {
    const kind = /^\s*@start(\w+)/i.exec(lines[startAt])![1].toLowerCase();
    if (kind !== 'uml') fail(startAt + 1, `only @startuml diagrams are read, not @start${kind}`);
    i = startAt + 1;
    started = true;
  }
  const out: Stmt[] = [];
  let direction: Direction = 'TB';
  let title: string | undefined;
  let block: RegExp | null = null;
  let comment = false;
  for (; i < lines.length; i++) {
    let t = lines[i].trim();
    const line = i + 1;
    if (comment) {
      const end = t.indexOf("'/");
      if (end < 0) continue;
      comment = false;
      t = t.slice(end + 2).trim();
    }
    // Block comments /' … '/ (on one line or several).
    t = t.replace(/\/'.*?'\//g, '').trim();
    const open = t.indexOf("/'");
    if (open >= 0) {
      comment = true;
      t = t.slice(0, open).trim();
    }
    if (!t || t.startsWith("'")) continue;
    if (started && /^@end\w*/i.test(t)) break;
    if (block) {
      if (block.test(t)) block = null;
      continue;
    }
    const b = BLOCKS.find(([start]) => start.test(t));
    if (b) {
      block = b[1];
      continue;
    }
    if (/^left\s+to\s+right\s+direction$/i.test(t)) direction = 'LR';
    if (/^!(?:include|import)/i.test(t)) fail(line, 'files are never included (paste their content instead)');
    if (/^!(?!theme|pragma)/.test(t)) fail(line, `the preprocessor ("${t.slice(0, 30)}") isn't supported`);
    const tt = /^title\s+(.+)$/i.exec(t);
    if (tt) {
      title = label(tt[1]);
      continue;
    }
    if (SKIPPED.test(t)) continue;
    out.push({ text: t, line });
  }
  if (!out.length) throw new LayoutError('The PlantUML diagram is empty');
  return { stmts: out, direction, ...(title ? { title } : {}) };
}

// ------------------------------------------------------------------------------- links

/** One end of a link as written: `"Quoted"`, `[Component]`, `(Use case)`, `:Actor:`, `[*]`, `(*)` or a name. */
interface Ref {
  kind: 'name' | 'quoted' | 'component' | 'usecase' | 'actor' | 'pseudo';
  text: string;
}

/** A name; dots only between word characters (`com.shop.Cart`), so `A..>B` is A, a dotted arrow, B. */
const NAME = String.raw`[A-Za-z0-9_$À-￿](?:[\w$À-￿]|\.(?=[\w$À-￿]))*`;
const REF = String.raw`"[^"]*"|\[\*\]|\[H\*?\]|\(\*[^)]*\)|\[[^\]]+\]|\([^)]+\)|:[^:]+:|${NAME}`;
const HEAD_L = String.raw`<\|?|<<|\*|o|\+|#|x|\}|\^|\(0|0\)|0`;
/** Letter-like heads (`o`, `x`, `0`) only when no name follows straight after them. */
const HEAD_R = String.raw`\|?>|>>|\*|o(?![\w$])|\+|#|x(?![\w$])|\{|\^|\(0|0\)|0(?![\w$])`;
const BODY = String.raw`[-.=~]+(?:\[[^\]]*\])?(?:(?:left|right|up|down|le|ri|do|l|r|u|d)(?=[-.=~]))?[-.=~]*`;
const LINK_RE = new RegExp(
  String.raw`^(${REF})\s*(?:"([^"]*)")?\s*(${HEAD_L})?(${BODY})(${HEAD_R})?\s*(?:"([^"]*)")?\s*(${REF})\s*(?::\s*(.*))?$`,
);

interface Link {
  from: Ref;
  to: Ref;
  left?: string;
  right?: string;
  dashed: boolean;
  thick: boolean;
  hidden: boolean;
  fromLabel?: string;
  toLabel?: string;
  label?: string;
}

function refOf(raw: string): Ref {
  if (raw.startsWith('"')) return { kind: 'quoted', text: label(raw) };
  if (raw === '[*]' || /^\[H\*?\]$/.test(raw) || raw.startsWith('(*')) return { kind: 'pseudo', text: raw };
  if (raw.startsWith('[')) return { kind: 'component', text: label(raw.slice(1, -1)) };
  if (raw.startsWith('(')) return { kind: 'usecase', text: label(raw.slice(1, -1)) };
  if (raw.startsWith(':')) return { kind: 'actor', text: label(raw.slice(1, -1)) };
  return { kind: 'name', text: raw };
}

function readLink(text: string): Link | null {
  const m = LINK_RE.exec(text);
  if (!m) return null;
  const [, a, aCard, left, body, right, bCard, b, lbl] = m;
  return {
    from: refOf(a),
    to: refOf(b),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
    dashed: body.includes('.'),
    thick: body.includes('='),
    hidden: /\[[^\]]*hidden[^\]]*\]/i.test(body),
    ...(aCard !== undefined ? { fromLabel: aCard } : {}),
    ...(bCard !== undefined ? { toLabel: bCard } : {}),
    ...(lbl?.trim() ? { label: label(lbl.replace(/^\s*<<\s*(.*?)\s*>>\s*$/, '«$1»')) } : {}),
  };
}

const CAP: Record<string, CapStyle> = {
  '<|': 'triangleOpen', '|>': 'triangleOpen', '^': 'triangleOpen', '<': 'arrow', '>': 'arrow', '<<': 'arrow', '>>': 'arrow',
  '*': 'diamond', o: 'diamondOpen', '+': 'circleOpen', '#': 'bar', x: 'bar', '}': 'many', '{': 'many', '0': 'circleOpen', '(0': 'circleOpen', '0)': 'circleOpen',
};

function edgeOf(l: Link, from: string, to: string): PlantEdge {
  return {
    from,
    to,
    style: l.dashed ? 'dashed' : l.thick ? 'thick' : 'solid',
    startCap: l.left ? CAP[l.left] : 'none',
    endCap: l.right ? CAP[l.right] : 'none',
    ...(l.label ? { label: clip(l.label) } : {}),
    ...(l.fromLabel ? { startLabel: clip(l.fromLabel) } : {}),
    ...(l.toLabel ? { endLabel: clip(l.toLabel) } : {}),
  };
}

// ------------------------------------------------------------------------------- boxes

// Class boxes (`tableSize`) and notes (`noteNode`) are measured as Mermaid's are (uml.ts).

/** `note left of X : text`, `note "text" as N`, or the head of a multi-line note (body up to `end note`). */
const NOTE_RE = /^[hr]?note\s+(?:(left|right|top|bottom|over)(?:\s+of)?\s+([^:]+?)|"([^"]*)"\s+as\s+(\S+)|as\s+(\S+)|(left|right|top|bottom))\s*(?::\s*(.*))?$/i;

/** Reads a note at `stmts[i]`; returns it and the index after it, or null. */
function readNote(stmts: Stmt[], i: number): { target: string | null; alias: string | null; text: string; next: number; side: string } | null {
  const m = NOTE_RE.exec(stmts[i].text);
  if (!m) return null;
  const target = m[2]?.trim() ?? null;
  const alias = m[4] ?? m[5] ?? null;
  const side = (m[1] ?? m[6] ?? 'right').toLowerCase();
  if (m[3] !== undefined) return { target: null, alias, text: label(m[3]), next: i + 1, side };
  if (m[7] !== undefined) return { target, alias, text: label(m[7]), next: i + 1, side };
  const body: string[] = [];
  let j = i + 1;
  for (; j < stmts.length && !/^end\s*[hr]?note$/i.test(stmts[j].text); j++) body.push(stmts[j].text);
  if (j >= stmts.length) fail(stmts[i].line, 'the note has no "end note"');
  return { target, alias, text: label(body.join('\n')), next: j + 1, side };
}

// ------------------------------------------------------------------------------- sequence

const PARTICIPANT = /^(participant|actor|boundary|control|entity|database|collections|queue)\s+("[^"]+"|\S+)(?:\s+as\s+("[^"]+"|\S+))?(?:\s+order\s+-?\d+)?(?:\s+<<[^>]*>>)?(?:\s+#\S+)?$/i;
const SEQ_IGNORED = /^(?:activate|deactivate|destroy|return|autoactivate|alt|else|opt|loop|par|par2|break|critical|group|end|box|end\s+box|ref\s+over.*end\s+ref|\.\.\.|\|\|\|?|\|\|\d+\|\||==.*==|delay\b|space\b)/i;
const SEQ_MSG = /^("[^"]+"|[\w.$À-￿]+)\s*(<?<?(?:[ox]|\/{1,2}|\\{1,2})?-{1,2}(?:\[[^\]]*\])?-?(?:>{1,2}|[ox]|\/{1,2}|\\{1,2})?(?:[ox])?)\s*("[^"]+"|[\w.$À-￿]+)\s*(?:[+\-*!]{1,2})?\s*(?::\s*(.*))?$/;

function isSequence(stmts: Stmt[]): boolean {
  let messages = 0;
  for (let i = 0; i < stmts.length; i++) {
    const t = stmts[i].text;
    if (PARTICIPANT.test(t) || SEQ_IGNORED.test(t) || /^create\s/i.test(t)) continue;
    const note = NOTE_RE.test(t) ? readNoteSafe(stmts, i) : null;
    if (note !== null) {
      i = note - 1;
      continue;
    }
    const m = SEQ_MSG.exec(t);
    if (!m || !/[<>ox\\/]/.test(m[2])) return false;
    messages++;
  }
  return messages > 0;
}

const readNoteSafe = (stmts: Stmt[], i: number) => {
  try {
    return readNote(stmts, i)?.next ?? null;
  } catch {
    return null;
  }
};

function parseSequence(stmts: Stmt[], title?: string): SequenceInput {
  const participants: SequenceInput['participants'] = [];
  const steps: SequenceInput['steps'] = [];
  const known = new Map<string, SequenceInput['participants'][number]>();
  const ensure = (raw: string, labelText?: string, actor?: boolean) => {
    const id = unquote(raw);
    let p = known.get(id);
    if (!p) {
      count(known.size + 1);
      p = { id, label: clip(labelText ?? id), ...(actor ? { actor: true } : {}) };
      known.set(id, p);
      participants.push(p);
    } else if (labelText) p.label = clip(labelText);
    return p.id;
  };
  let last: { from: string; to: string } | null = null;
  for (let i = 0; i < stmts.length; i++) {
    const { text, line } = stmts[i];
    const p = PARTICIPANT.exec(text);
    if (p) {
      // `participant Long as L` / `participant "Long name" as L`: the alias names it in messages;
      // `participant L as "Long name"`: the quoted one is what is shown.
      const [first, second] = [p[2], p[3]];
      const quotedSecond = !!second?.startsWith('"');
      const id = second ? (quotedSecond ? first : second) : first;
      const name = second ? (quotedSecond ? second : first) : first;
      ensure(id, label(name), p[1].toLowerCase() === 'actor');
      continue;
    }
    const created = /^create\s+(?:(?:participant|actor|boundary|control|entity|database|collections|queue)\s+)?(\S+)$/i.exec(text);
    if (created) {
      ensure(created[1]);
      continue;
    }
    if (SEQ_IGNORED.test(text)) continue;
    const note = NOTE_RE.test(text) ? readNote(stmts, i) : null;
    if (note) {
      i = note.next - 1;
      const over = note.target ? note.target.split(',').map((s) => ensure(s.trim())) : last ? [last.to] : [];
      if (!over.length) fail(line, 'which participant is the note for?');
      steps.push({ kind: 'note', over, side: note.side === 'left' ? 'left' : note.side === 'over' ? 'over' : 'right', text: clip(note.text) });
      continue;
    }
    const m = SEQ_MSG.exec(text);
    if (!m) fail(line, `can't read "${text.slice(0, 40)}"`);
    const [, a, op, b, msg] = m!;
    const reverse = op.startsWith('<') && !/>/.test(op);
    const from = ensure(reverse ? b : a);
    const to = ensure(reverse ? a : b);
    const head = reverse ? op.slice(0, 2) : op.slice(-2);
    steps.push({
      kind: 'message',
      from,
      to,
      text: clip(label(msg ?? '')),
      dashed: /--/.test(op),
      arrow: /x/.test(head) ? 'cross' : />>|<<|\/|\\/.test(head) ? 'open' : /[<>]/.test(op) ? 'arrow' : 'none',
    });
    last = { from, to };
    count(steps.length);
  }
  return { ...(title ? { title } : {}), participants, steps };
}

// ------------------------------------------------------------------------------- class diagrams

const CLASS_KIND = /^(abstract\s+class|abstract|class|interface|enum|annotation|entity|struct|protocol|exception|metaclass|stereotype|circle|diamond)\s+(.+)$/i;

interface ClassBox {
  id: string;
  name: string;
  stereo?: string;
  abstract: boolean;
  members: string[];
  group?: string;
}

/** One member as UML writes it: visibility kept, `{static}` underlined, `{abstract}` italic. */
function memberHtml(raw: string): { html: string; plain: string; op: boolean } {
  let t = raw.trim();
  let mark: 'static' | 'abstract' | null = null;
  t = t.replace(/\{(static|classifier|abstract)\}\s*/gi, (_m, k: string) => {
    mark = k.toLowerCase() === 'abstract' ? 'abstract' : 'static';
    return '';
  });
  let op = t.includes('(');
  t = t.replace(/\{(field|method)\}\s*/gi, (_m, k: string) => {
    op = k.toLowerCase() === 'method';
    return '';
  });
  const html = escapeHtml(t);
  return { html: mark === 'static' ? `<u>${html}</u>` : mark === 'abstract' ? `<i>${html}</i>` : html, plain: t, op };
}

function parseClass(stmts: Stmt[], direction: Direction): PlantUmlDiagram {
  const classes = new Map<string, ClassBox>();
  const alias = new Map<string, string>();
  const edges: PlantEdge[] = [];
  const groups: GraphGroupInput[] = [];
  const notes: PlantNode[] = [];
  const stack: Array<string | null> = [];
  const group = () => [...stack].reverse().find((g) => g !== null) ?? undefined;
  const idOf = (raw: string) => alias.get(unquote(raw)) ?? unquote(raw);
  const ensure = (raw: string): ClassBox => {
    const id = idOf(raw);
    let c = classes.get(id);
    if (!c) {
      count(classes.size + edges.length + 1);
      c = { id, name: id, abstract: false, members: [], ...(group() ? { group: group() } : {}) };
      classes.set(id, c);
    }
    return c;
  };
  for (let i = 0; i < stmts.length; i++) {
    const { text, line } = stmts[i];
    const pkg = /^(package|namespace|folder|frame|cloud|node|rectangle|together)\b\s*("[^"]*"|[^\s{<#]*)?[^{]*\{$/i.exec(text);
    if (pkg) {
      if (pkg[1].toLowerCase() === 'together' || !pkg[2]) stack.push(null);
      else {
        const id = `g:${groups.length + 1}`;
        groups.push({ id, title: clip(label(pkg[2])), nodes: [], parent: group() ?? null });
        stack.push(id);
      }
      continue;
    }
    if (text === '}') {
      if (!stack.length) fail(line, '"}" without a class or package');
      stack.pop();
      continue;
    }
    const decl = CLASS_KIND.exec(text);
    if (decl) {
      const kind = decl[1].toLowerCase().replace(/\s+/, ' ');
      let rest = decl[2].trim();
      const opens = rest.endsWith('{');
      if (opens) rest = rest.slice(0, -1).trim();
      // Inline body on one line: `class A { +x }`.
      let inline: string | null = null;
      const inl = /^(.*?)\{(.*)\}$/.exec(rest);
      if (inl) {
        rest = inl[1].trim();
        inline = inl[2];
      }
      const pendingParents: Array<{ ext: string[]; imp: string[] }> = [];
      rest = rest.replace(/\s+#\S+/g, '').replace(/\s+(?:extends|implements)\s+.*$/i, (tail) => {
        // `class A extends B implements C, D`: generalisation / realisation lines.
        const ext = /extends\s+([\w.,\s]+?)(?=\s+implements|$)/i.exec(tail);
        const imp = /implements\s+([\w.,\s]+)$/i.exec(tail);
        pendingParents.push({ ext: ext?.[1].split(',').map((s) => s.trim()) ?? [], imp: imp?.[1].split(',').map((s) => s.trim()) ?? [] });
        return '';
      });
      const sm = /^("[^"]+"|[^\s<]+(?:<[^>]*>)?)(?:\s+as\s+("[^"]+"|\S+))?\s*(?:<<\s*(.+?)\s*>>)?$/.exec(rest);
      if (!sm) fail(line, `can't read the ${kind} "${rest.slice(0, 40)}"`);
      const [, rawName, rawAlias, stereo] = sm!;
      const shown = unquote(rawName);
      const id = rawAlias ? unquote(rawAlias) : shown.replace(/<[^>]*>$/, '');
      if (rawAlias) alias.set(shown, id);
      const c = ensure(id);
      c.name = shown;
      if (stereo) c.stereo = stereo;
      else if (kind === 'interface' || kind === 'enum' || kind === 'annotation' || kind === 'struct' || kind === 'protocol' || kind === 'exception') c.stereo = kind === 'enum' ? 'enumeration' : kind;
      if (kind.startsWith('abstract')) c.abstract = true;
      if (inline) c.members.push(...inline.split(/;|\s{2,}/).map((s) => s.trim()).filter(Boolean));
      if (opens) {
        let j = i + 1;
        for (; j < stmts.length && stmts[j].text !== '}'; j++) {
          const m = stmts[j].text;
          if (/^(?:--|\.\.|==|__)(?:.*(?:--|\.\.|==|__))?$/.test(m)) continue; // compartment separators
          c.members.push(m);
        }
        if (j >= stmts.length) fail(line, `${kind} "${shown}" has no closing "}"`);
        i = j;
      }
      for (const p of pendingParents) {
        for (const e of p.ext) edges.push({ from: c.id, to: ensure(e).id, style: 'solid', startCap: 'none', endCap: 'triangleOpen' });
        for (const e of p.imp) edges.push({ from: c.id, to: ensure(e).id, style: 'dashed', startCap: 'none', endCap: 'triangleOpen' });
      }
      continue;
    }
    const note = readNote(stmts, i);
    if (note) {
      i = note.next - 1;
      const id = note.alias ?? `note:${notes.length + 1}`;
      notes.push(noteNode(id, note.text));
      if (note.alias) alias.set(note.alias, id);
      if (note.target) edges.push({ from: id, to: ensure(note.target).id, style: 'dashed', arrow: 'none', startCap: 'none', endCap: 'none' });
      continue;
    }
    const link = readLink(text);
    if (link) {
      if (link.hidden) continue;
      const end = (r: Ref) => (notes.some((n) => n.id === idOf(r.text)) ? idOf(r.text) : ensure(r.text).id);
      count(classes.size + edges.length + 1);
      edges.push(edgeOf(link, end(link.from), end(link.to)));
      continue;
    }
    const member = /^("[^"]+"|[\w.$À-￿]+)\s*:\s*(.+)$/.exec(text);
    if (member) {
      ensure(member[1]).members.push(member[2].trim());
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  if (!classes.size) throw new LayoutError('The class diagram has no classes');

  const nodes: PlantNode[] = [];
  for (const c of classes.values()) {
    const members = c.members.map(memberHtml);
    const attrs = members.filter((m) => !m.op);
    const ops = members.filter((m) => m.op);
    const name = `${c.stereo ? `«${c.stereo}» ` : ''}${c.name}`;
    const attrLines = attrs.length ? attrs : [{ html: '', plain: '', op: false }];
    const nameHtml = c.abstract ? `<b><i>${escapeHtml(name)}</i></b>` : `<b>${escapeHtml(name)}</b>`;
    nodes.push({
      id: c.id,
      text: clip(name),
      shape: 'umlClass',
      size: tableSize([{ text: name, bold: true }, ...attrLines.map((m) => ({ text: m.plain })), ...ops.map((m) => ({ text: m.plain }))], ops.length ? 0 : 14),
      look: { text: clip([nameHtml, ...attrLines.map((m) => m.html), ...ops.map((m) => m.html)].join('<br>')), compartments: true, fontSize: TABLE_FONT, align: 'left', vAlign: 'top' },
    });
    if (c.group) groups.find((g) => g.id === c.group)!.nodes.push(c.id);
  }
  nodes.push(...notes);
  return { kind: 'class', direction, nodes, edges, groups: groups.filter((g) => g.nodes.length || groups.some((h) => h.parent === g.id)) };
}

// ------------------------------------------------------------------------------- state diagrams

const STATE_SPECIAL: Record<string, 'choice' | 'fork' | 'join' | 'start' | 'end' | 'history'> = {
  choice: 'choice', fork: 'fork', join: 'join', start: 'start', end: 'end', entrypoint: 'start', exitpoint: 'end', history: 'history', 'history*': 'history',
};

function parseState(stmts: Stmt[], direction: Direction): PlantUmlDiagram {
  interface State {
    id: string;
    label: string;
    descriptions: string[];
    kind: 'state' | 'start' | 'end' | 'choice' | 'fork' | 'join' | 'history';
    scope: string | null;
  }
  const states = new Map<string, State>();
  const composites = new Map<string, GraphGroupInput>();
  const alias = new Map<string, string>();
  const edges: PlantEdge[] = [];
  const notes: Array<{ node: PlantNode; for: string | null }> = [];
  const stack: string[] = [];
  const scope = () => stack[stack.length - 1] ?? null;
  const ensure = (raw: string, as: 'from' | 'to' | 'decl' = 'decl'): string => {
    if (raw === '[*]') {
      // A scope's [*] is its start when a line leaves it, its end when a line arrives.
      const kind = as === 'to' ? 'end' : 'start';
      const key = `[*]${kind}:${scope() ?? ''}`;
      if (!states.has(key)) states.set(key, { id: key, label: '', descriptions: [], kind, scope: scope() });
      return key;
    }
    if (/^\[H\*?\]$/.test(raw)) {
      const key = `${raw}:${scope() ?? ''}`;
      if (!states.has(key)) states.set(key, { id: key, label: raw.slice(1, -1), descriptions: [], kind: 'history', scope: scope() });
      return key;
    }
    const id = alias.get(unquote(raw)) ?? unquote(raw);
    if (composites.has(id)) return id;
    if (!states.has(id)) {
      count(states.size + composites.size + edges.length + 1);
      states.set(id, { id, label: id, descriptions: [], kind: 'state', scope: scope() });
    }
    return id;
  };
  for (let i = 0; i < stmts.length; i++) {
    const { text, line } = stmts[i];
    if (text === '--' || text === '||') continue; // concurrent regions: drawn side by side in the composite
    if (text === '}') {
      if (!stack.pop()) fail(line, '"}" without a composite state');
      continue;
    }
    const st = /^state\s+("[^"]+"|[\w.$À-￿]+)(?:\s+as\s+("[^"]+"|[\w.$À-￿]+))?\s*(?:<<\s*(\w+\*?)\s*>>)?\s*(?:#[\w#;.:\[\]-]+)?\s*(\{)?\s*(?::\s*(.*))?$/i.exec(text);
    if (st) {
      const [, a, b, special, brace, desc] = st;
      const quotedFirst = a.startsWith('"');
      const id = b ? (quotedFirst ? unquote(b) : unquote(a)) : unquote(a);
      const shown = b ? (quotedFirst ? label(a) : label(b)) : label(a);
      if (b) alias.set(shown, id);
      if (brace) {
        if (composites.has(id)) fail(line, `composite state "${id}" is declared twice`);
        const was = states.get(id);
        if (was && was.kind === 'state') states.delete(id);
        composites.set(id, { id, title: clip(shown), nodes: [], parent: scope() });
        stack.push(id);
        continue;
      }
      const s = states.get(ensure(id));
      if (s) {
        s.label = shown;
        if (special) {
          // Other stereotypes (SDL and the like) draw as plain states named with them.
          const k = STATE_SPECIAL[special.toLowerCase()];
          if (k) s.kind = k;
          else s.label = `«${special}» ${shown}`;
        }
        if (desc) s.descriptions.push(label(desc));
      }
      continue;
    }
    const note = readNote(stmts, i);
    if (note) {
      i = note.next - 1;
      const id = note.alias ?? `note:${notes.length + 1}`;
      notes.push({ node: noteNode(id, note.text), for: note.target ? ensure(note.target) : null });
      continue;
    }
    const link = readLink(text);
    if (link) {
      if (link.hidden) continue;
      const reverse = !!link.left && !link.right;
      const [a, b] = reverse ? [link.to, link.from] : [link.from, link.to];
      const from = ensure(a.text, 'from');
      const to = ensure(b.text, 'to');
      count(states.size + edges.length + 1);
      edges.push({ from, to, arrow: 'forward', style: link.dashed ? 'dashed' : 'solid', ...(link.label ? { label: clip(link.label) } : {}) });
      continue;
    }
    const desc = /^("[^"]+"|[\w.$À-￿]+)\s*:\s*(.+)$/.exec(text);
    if (desc) {
      const id = ensure(desc[1]);
      if (composites.has(id)) composites.get(id)!.title = clip(`${composites.get(id)!.title}: ${label(desc[2])}`);
      else states.get(id)!.descriptions.push(label(desc[2]));
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  if (stack.length) throw new LayoutError(`PlantUML: composite state "${stack[stack.length - 1]}" has no closing "}"`);
  if (!states.size && !composites.size) throw new LayoutError('The state diagram has no states');

  const across = direction === 'LR' || direction === 'RL';
  const nodes: PlantNode[] = [];
  for (const s of states.values()) {
    if (s.scope) composites.get(s.scope)!.nodes.push(s.id);
    nodes.push(stateNode(s.id, s.kind, [s.label, ...s.descriptions].join('\n'), across));
  }
  for (const n of notes) {
    nodes.push(n.node);
    const target = n.for ? states.get(n.for) : undefined;
    if (target?.scope) composites.get(target.scope)!.nodes.push(n.node.id);
    if (n.for) edges.push({ from: n.node.id, to: n.for, style: 'dashed', arrow: 'none' });
  }
  return { kind: 'state', direction, nodes, edges, groups: [...composites.values()] };
}

function stateNode(id: string, kind: 'state' | 'start' | 'end' | 'choice' | 'fork' | 'join' | 'history', text: string, across: boolean): PlantNode {
  if (kind === 'start') return { id, text: '', shape: 'ellipse', size: { w: 28, h: 28 }, look: { fill: INK, stroke: INK } };
  if (kind === 'end') return { id, text: '', shape: 'bpmnEnd', size: { w: 34, h: 34 }, look: { fill: '#FFFFFF', stroke: INK } };
  if (kind === 'choice') return { id, text: '', shape: 'diamond', size: { w: 44, h: 44 } };
  if (kind === 'history') return { id, text: clip(text), shape: 'ellipse', size: { w: 40, h: 40 } };
  if (kind === 'fork' || kind === 'join') return { id, text: '', shape: 'rect', size: across ? { w: 10, h: 96 } : { w: 96, h: 10 }, look: { fill: INK, stroke: INK } };
  return { id, text: clip(text), shape: 'roundRect' };
}

// ------------------------------------------------------------------------------- activity diagrams

function parseActivity(stmts: Stmt[], direction: Direction): PlantUmlDiagram {
  const nodes: PlantNode[] = [];
  const edges: PlantEdge[] = [];
  const groups: GraphGroupInput[] = [];
  type Tail = { id: string; label?: string };
  let tails: Tail[] = [];
  let pending: string | undefined; // `-> label;` for the next line drawn
  interface Blocks {
    group: { kind: 'group'; id: string };
    if: { kind: 'if'; decision: string; ends: Tail[]; hasElse: boolean };
    switch: { kind: 'switch'; decision: string; ends: Tail[] };
    while: { kind: 'while'; node: string };
    repeat: { kind: 'repeat'; start: string | null; backward: string | null };
    fork: { kind: 'fork'; from: Tail[]; ends: Tail[] };
    split: { kind: 'split'; from: Tail[]; ends: Tail[] };
  }
  const blocks: Array<Blocks[keyof Blocks]> = [];
  let lane: string | null = null;
  const lanes = new Map<string, string>();
  let last: string | null = null;
  const groupNow = () => {
    for (let k = blocks.length - 1; k >= 0; k--) {
      const b = blocks[k];
      if (b.kind === 'group') return b.id;
    }
    return lane;
  };
  const add = (n: PlantNode, connect = true): string => {
    count(nodes.length + edges.length + 1);
    nodes.push(n);
    const g = groupNow();
    if (g) groups.find((x) => x.id === g)!.nodes.push(n.id);
    if (connect)
      for (const t of tails) {
        const lbl = t.label ?? pending;
        edges.push({ from: t.id, to: n.id, arrow: 'forward', ...(lbl ? { label: clip(lbl) } : {}) });
      }
    pending = undefined;
    // The first node inside a `repeat` is where the loop comes back to.
    for (const b of blocks) if (b.kind === 'repeat' && b.start === null) b.start = n.id;
    tails = [{ id: n.id }];
    last = n.id;
    return n.id;
  };
  const nid = () => `a${nodes.length + 1}`;
  const action = (text: string) => {
    const t = clip(label(text));
    return { id: nid(), text: t, shape: 'roundRect' as ShapeKind };
  };
  const decision = (cond: string): PlantNode => {
    const t = clip(label(cond));
    return { id: nid(), text: t, shape: 'diamond' };
  };
  const top = <K extends keyof Blocks>(kind: K, line: number): Blocks[K] => {
    const b = blocks[blocks.length - 1];
    if (!b || b.kind !== kind) fail(line, `"${stmts.find((s) => s.line === line)?.text}" without its opening ${kind}`);
    return b as Blocks[K];
  };
  // `(*)`-style arrows of the old syntax: "(*) --> "First" --> (*)".
  const legacy = new Map<string, string>();

  for (let i = 0; i < stmts.length; i++) {
    const { text, line } = stmts[i];
    let m: RegExpExecArray | null;
    if (/^start$/i.test(text)) {
      tails = [];
      add({ id: nid(), text: '', shape: 'ellipse', size: { w: 28, h: 28 }, look: { fill: INK, stroke: INK } }, false);
      continue;
    }
    if (/^(?:stop|end)$/i.test(text)) {
      add({ id: nid(), text: '', shape: 'bpmnEnd', size: { w: 34, h: 34 }, look: { fill: '#FFFFFF', stroke: INK } });
      tails = [];
      continue;
    }
    if (/^(?:kill|detach)$/i.test(text)) {
      tails = [];
      continue;
    }
    if (text.startsWith(':') || /^#[\w#]+:/.test(text)) {
      // An action, possibly over several lines, ended by `;` (or an SDL ending | < > / ] }).
      let body = text.replace(/^#[\w#]+:/, ':').slice(1);
      let j = i;
      while (!/[;|<>/\]}]$/.test(body) && j + 1 < stmts.length) body += `\n${stmts[++j].text}`;
      if (!/[;|<>/\]}]$/.test(body)) fail(line, 'the action has no closing ";"');
      i = j;
      add(action(body.slice(0, -1)));
      continue;
    }
    if ((m = /^-+(?:\[[^\]]*\])?-*>\s*(.*?);?$/.exec(text))) {
      pending = m[1] ? label(m[1]) : undefined;
      continue;
    }
    if ((m = /^if\s*\((.*?)\)\s*(?:is\s*\((.*?)\)\s*)?then\s*(?:\((.*)\))?$/i.exec(text))) {
      const d = add(decision(m[1]));
      blocks.push({ kind: 'if', decision: d, ends: [], hasElse: false });
      const yes = m[3] ?? m[2];
      tails = [{ id: d, ...(yes ? { label: label(yes) } : {}) }];
      continue;
    }
    if ((m = /^else\s*if\s*\((.*?)\)\s*(?:is\s*\((.*?)\)\s*)?then\s*(?:\((.*)\))?$/i.exec(text))) {
      const b = top('if', line);
      b.ends.push(...tails);
      tails = [{ id: b.decision }];
      const d = add(decision(m[1]));
      b.decision = d;
      const yes = m[3] ?? m[2];
      tails = [{ id: d, ...(yes ? { label: label(yes) } : {}) }];
      continue;
    }
    if ((m = /^else\s*(?:\((.*)\))?$/i.exec(text))) {
      const b = top('if', line);
      b.ends.push(...tails);
      b.hasElse = true;
      tails = [{ id: b.decision, ...(m[1] ? { label: label(m[1]) } : {}) }];
      continue;
    }
    if (/^end\s*if$/i.test(text)) {
      const b = top('if', line);
      blocks.pop();
      tails = b.hasElse ? [...b.ends, ...tails] : [...b.ends, ...tails, { id: b.decision }];
      continue;
    }
    if ((m = /^switch\s*\((.*)\)$/i.exec(text))) {
      const d = add(decision(m[1]));
      blocks.push({ kind: 'switch', decision: d, ends: [] });
      tails = [];
      continue;
    }
    if ((m = /^case\s*\((.*)\)$/i.exec(text))) {
      const b = top('switch', line);
      b.ends.push(...tails);
      tails = [{ id: b.decision, label: label(m[1]) }];
      continue;
    }
    if (/^end\s*switch$/i.test(text)) {
      const b = top('switch', line);
      blocks.pop();
      tails = [...b.ends, ...tails];
      continue;
    }
    if ((m = /^while\s*\((.*?)\)\s*(?:is\s*\((.*)\))?$/i.exec(text))) {
      const w = add(decision(m[1]));
      blocks.push({ kind: 'while', node: w });
      tails = [{ id: w, ...(m[2] ? { label: label(m[2]) } : {}) }];
      continue;
    }
    if ((m = /^end\s*while\s*(?:\((.*)\))?$/i.exec(text))) {
      const b = top('while', line);
      blocks.pop();
      for (const t of tails) edges.push({ from: t.id, to: b.node, arrow: 'forward', ...(t.label ? { label: clip(t.label) } : {}) });
      tails = [{ id: b.node, ...(m[1] ? { label: label(m[1]) } : {}) }];
      continue;
    }
    if ((m = /^repeat\s*(?::(.*);)?$/i.exec(text))) {
      blocks.push({ kind: 'repeat', start: null, backward: null });
      if (m[1] !== undefined) add(action(m[1]));
      continue;
    }
    if ((m = /^backward\s*:(.*);$/i.exec(text))) {
      const b = top('repeat', line);
      count(nodes.length + 1);
      const n = action(m[1]);
      nodes.push(n);
      const g = groupNow();
      if (g) groups.find((x) => x.id === g)!.nodes.push(n.id);
      b.backward = n.id;
      continue;
    }
    if ((m = /^repeat\s*while\s*\((.*?)\)\s*(?:is\s*\((.*?)\))?\s*(?:not\s*\((.*?)\))?$/i.exec(text))) {
      const b = top('repeat', line);
      blocks.pop();
      const r = add(decision(m[1]));
      const back = b.backward ?? null;
      if (b.start) {
        if (back) {
          edges.push({ from: r, to: back, arrow: 'forward', ...(m[2] ? { label: label(m[2]) } : {}) });
          edges.push({ from: back, to: b.start, arrow: 'forward' });
        } else edges.push({ from: r, to: b.start, arrow: 'forward', ...(m[2] ? { label: label(m[2]) } : {}) });
      }
      tails = [{ id: r, ...(m[3] ? { label: label(m[3]) } : {}) }];
      continue;
    }
    if (/^(?:fork|split)$/i.test(text)) {
      const kind = text.toLowerCase() as 'fork' | 'split';
      if (kind === 'fork') add({ id: nid(), text: '', shape: 'rect', size: { w: 120, h: 10 }, look: { fill: INK, stroke: INK } });
      blocks.push({ kind, from: tails, ends: [] });
      continue;
    }
    if ((m = /^(fork|split)\s+again$/i.exec(text))) {
      const b = top(m[1].toLowerCase() as 'fork' | 'split', line);
      b.ends.push(...tails);
      tails = b.from;
      continue;
    }
    if ((m = /^end\s*(fork|merge|split)(?:\s*\{.*\})?$/i.exec(text))) {
      const kind = m[1].toLowerCase() === 'split' ? 'split' : 'fork';
      const b = top(kind, line);
      blocks.pop();
      tails = [...b.ends, ...tails];
      if (kind === 'fork') add({ id: nid(), text: '', shape: 'rect', size: { w: 120, h: 10 }, look: { fill: INK, stroke: INK } });
      continue;
    }
    if ((m = /^(?:partition|group|package|rectangle|card)\s+("[^"]*"|[^{]+?)\s*(?:#\S+\s*)?\{?$/i.exec(text))) {
      const id = `g:${groups.length + 1}`;
      groups.push({ id, title: clip(label(m[1])), nodes: [], parent: groupNow() });
      blocks.push({ kind: 'group', id });
      continue;
    }
    if (text === '}' || /^end\s*(?:group|partition)$/i.test(text)) {
      top('group', line);
      blocks.pop();
      continue;
    }
    if ((m = /^\|(?:#[^|]+\|)?([^|]+)\|$/.exec(text))) {
      // A swimlane: what follows belongs to it (lanes are frames side by side).
      const name = m[1].trim();
      if (!lanes.has(name)) {
        const id = `lane:${lanes.size + 1}`;
        lanes.set(name, id);
        groups.push({ id, title: clip(name), nodes: [] });
      }
      lane = lanes.get(name)!;
      continue;
    }
    const note = readNote(stmts, i);
    if (note) {
      i = note.next - 1;
      const id = `note:${nodes.length + 1}`;
      count(nodes.length + 1);
      nodes.push(noteNode(id, note.text));
      if (last) edges.push({ from: id, to: last, style: 'dashed', arrow: 'none' });
      continue;
    }
    // The old syntax: `(*) --> "Action" --> (*)`, `"A" --> [label] "B"`, `if "cond" then` is not read.
    if ((m = /^("[^"]*"|\(\*[^)]*\)|[\w.]+)\s*(-+(?:\[[^\]]*\])?(?:left|right|up|down)?-*>)\s*(?:\[([^\]]*)\]\s*)?("[^"]*"|\(\*[^)]*\)|[\w.]+)(?:\s+as\s+(\w+))?$/i.exec(text))) {
      const end = (raw: string, as: 'from' | 'to', aliasName?: string) => {
        if (raw.startsWith('(*')) {
          const key = as === 'from' ? '(*)start' : '(*)end';
          if (!legacy.has(key)) {
            const n = as === 'from' ? { id: nid(), text: '', shape: 'ellipse' as ShapeKind, size: { w: 28, h: 28 }, look: { fill: INK, stroke: INK } } : { id: nid(), text: '', shape: 'bpmnEnd' as ShapeKind, size: { w: 34, h: 34 }, look: { fill: '#FFFFFF', stroke: INK } };
            count(nodes.length + 1);
            nodes.push(n);
            legacy.set(key, n.id);
          }
          return legacy.get(key)!;
        }
        const key = aliasName ?? unquote(raw);
        if (!legacy.has(key) && !legacy.has(unquote(raw))) {
          const n = action(raw);
          count(nodes.length + 1);
          nodes.push(n);
          legacy.set(key, n.id);
        }
        return legacy.get(key) ?? legacy.get(unquote(raw))!;
      };
      const from = end(m[1], 'from');
      const to = end(m[4], 'to', m[5]);
      edges.push({ from, to, arrow: 'forward', style: m[2].includes('.') ? 'dashed' : 'solid', ...(m[3] ? { label: clip(label(m[3])) } : {}) });
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  const open = blocks.find((b) => b.kind !== 'group');
  if (open) throw new LayoutError(`PlantUML: a "${open.kind}" has no end (end${open.kind === 'if' ? 'if' : ` ${open.kind}`})`);
  if (!nodes.length) throw new LayoutError('The activity diagram has no actions');
  return { kind: 'activity', direction, nodes, edges, groups: groups.filter((g) => g.nodes.length) };
}

// ------------------------------------------------------------------------------- use case and component diagrams

/** Element keywords of description diagrams → the shape drawn. */
const ELEMENT: Record<string, ShapeKind> = {
  actor: 'umlActor', person: 'umlActor', agent: 'rect', usecase: 'ellipse', component: 'umlComponent', interface: 'ellipse', node: 'umlNode',
  database: 'cylinder', cloud: 'cloud', folder: 'umlPackage', frame: 'rect', package: 'umlPackage', rectangle: 'rect', artifact: 'document',
  card: 'rect', file: 'document', queue: 'cylinder', stack: 'rect', storage: 'roundRect', boundary: 'ellipse', control: 'ellipse', entity: 'ellipse',
  collections: 'rect', hexagon: 'hexagon', label: 'rect', process: 'rect', action: 'roundRect', circle: 'ellipse',
};
const CONTAINERS = new Set(['package', 'node', 'folder', 'frame', 'cloud', 'database', 'rectangle', 'component', 'card', 'together', 'namespace', 'stack', 'storage', 'queue', 'hexagon']);
const ELEMENT_RE = new RegExp(String.raw`^(${Object.keys(ELEMENT).join('|')}|namespace|together)(?:/)?\s+(.*)$`, 'i');
/** A name as written in a declaration: quoted, bracketed, parenthesised, between colons, or a word. */
const DECL_NAME = /^("[^"]*"|\[[^\]]*\]|\([^)]*\)|:[^:]+:|[^\s{<#]+)(?:\s+as\s+("[^"]*"|\[[^\]]*\]|\([^)]*\)|:[^:]+:|[^\s{<#]+))?\s*(?:<<\s*(.+?)\s*>>)?\s*(?:#[\w#;.:-]+\s*)?(\{)?$/;

function parseDescription(stmts: Stmt[], direction: Direction): PlantUmlDiagram {
  const nodes = new Map<string, PlantNode>();
  const alias = new Map<string, string>();
  const edges: PlantEdge[] = [];
  const groups: GraphGroupInput[] = [];
  const stack: Array<string | null> = [];
  const groupNow = () => [...stack].reverse().find((g) => g !== null) ?? null;
  const strip = (raw: string) => (/^[[(:]/.test(raw) && raw.length > 1 ? raw.slice(1, -1) : unquote(raw));
  const kindOfToken = (raw: string): ShapeKind | null => (raw.startsWith('[') ? 'umlComponent' : raw.startsWith('(') ? 'ellipse' : raw.startsWith(':') ? 'umlActor' : null);
  const put = (id: string, text: string, shape: ShapeKind, stereo?: string) => {
    let n = nodes.get(id);
    const shown = clip(stereo ? `«${stereo}»\n${text}` : text);
    if (!n) {
      count(nodes.size + edges.length + 1);
      n = { id, text: shown, shape };
      nodes.set(id, n);
      const g = groupNow();
      if (g) groups.find((x) => x.id === g)!.nodes.push(id);
    } else {
      n.text = shown;
      n.shape = shape;
    }
    return n;
  };
  const resolve = (r: Ref): string => {
    if (r.kind === 'pseudo') return put(r.text, '', r.text.startsWith('(') ? 'ellipse' : 'ellipse').id;
    const key = r.text;
    const known = alias.get(key) ?? (nodes.has(key) ? key : null);
    if (known) return known;
    // Undeclared: what the brackets say it is; a bare name is a use case's actor or a box.
    const shape = r.kind === 'component' ? 'umlComponent' : r.kind === 'usecase' ? 'ellipse' : r.kind === 'actor' ? 'umlActor' : 'rect';
    return put(key, key, shape).id;
  };
  for (let i = 0; i < stmts.length; i++) {
    const { text, line } = stmts[i];
    if (text === '}') {
      if (!stack.length) fail(line, '"}" without a package or node');
      stack.pop();
      continue;
    }
    const el = ELEMENT_RE.exec(text);
    if (el) {
      const kw = el[1].toLowerCase();
      const d = DECL_NAME.exec(el[2].trim());
      if (!d) fail(line, `can't read the ${kw} "${el[2].slice(0, 40)}"`);
      const [, rawName, rawAlias, stereo, brace] = d!;
      if (brace && (CONTAINERS.has(kw) || kw === 'together')) {
        if (kw === 'together') stack.push(null);
        else {
          const id = `g:${groups.length + 1}`;
          groups.push({ id, title: clip(label(strip(rawName))), nodes: [], parent: groupNow() });
          if (rawAlias) alias.set(strip(rawAlias), id);
          alias.set(strip(rawName), id);
          stack.push(id);
        }
        continue;
      }
      if (brace) fail(line, `a ${kw} can't hold other elements`);
      // `actor "Long name" as A` / `actor A as "Long name"`: the shown text is the quoted / bracketed one.
      const decorated = (s?: string) => !!s && /^["[(:]/.test(s);
      const [shownRaw, idRaw] = rawAlias ? (decorated(rawName) || !decorated(rawAlias) ? [rawName, rawAlias] : [rawAlias, rawName]) : [rawName, rawName];
      const shown = label(strip(shownRaw));
      const id = strip(idRaw);
      put(id, shown, ELEMENT[kw] ?? 'rect', stereo);
      alias.set(shown, id);
      if (strip(rawName) !== id) alias.set(strip(rawName), id);
      continue;
    }
    // `[Component] as C`, `(Use case) as UC`, `:Actor: as A`, `() "Interface" as I`, standing alone.
    const short = /^(\(\)\s*)?("[^"]*"|\[[^\]]+\]|\([^)]+\)|:[^:]+:|[\w.$À-￿]+)(?:\s+as\s+([\w.$À-￿]+))?\s*(?:<<\s*(.+?)\s*>>)?$/.exec(text);
    if (short && (short[1] || /^["[(:]/.test(short[2]) || short[3])) {
      const shape = short[1] ? 'ellipse' : (kindOfToken(short[2]) ?? 'rect');
      const shown = label(strip(short[2]));
      const id = short[3] ?? shown;
      put(id, shown, shape, short[4]);
      alias.set(shown, id);
      continue;
    }
    const note = readNote(stmts, i);
    if (note) {
      i = note.next - 1;
      const id = note.alias ?? `note:${nodes.size + 1}`;
      const n = noteNode(id, note.text);
      nodes.set(id, n);
      const g = groupNow();
      if (g) groups.find((x) => x.id === g)!.nodes.push(id);
      if (note.target) edges.push({ from: id, to: resolve(refOf(note.target)), style: 'dashed', arrow: 'none' });
      continue;
    }
    const link = readLink(text);
    if (link) {
      if (link.hidden) continue;
      count(nodes.size + edges.length + 1);
      edges.push(edgeOf(link, resolve(link.from), resolve(link.to)));
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  if (!nodes.size) throw new LayoutError('The diagram has no elements');
  // A group named in a link stands for its frame: link to its first member instead.
  const groupIds = new Set(groups.map((g) => g.id));
  const firstMember = (gid: string): string | null => {
    const g = groups.find((x) => x.id === gid)!;
    return g.nodes[0] ?? groups.filter((x) => x.parent === gid).map((x) => firstMember(x.id)).find(Boolean) ?? null;
  };
  const kept = edges
    .map((e) => ({ ...e, from: groupIds.has(e.from) ? firstMember(e.from) ?? '' : e.from, to: groupIds.has(e.to) ? firstMember(e.to) ?? '' : e.to }))
    .filter((e) => e.from && e.to);
  const out = [...nodes.values()].map((n) => (n.shape === 'umlActor' && !n.size ? { ...n, size: { w: Math.max(80, measureText(n.text, { fontSize: 16, maxWidth: 200 }).w + 16), h: 110 } } : n));
  return { kind: 'description', direction, nodes: out, edges: kept, groups: groups.filter((g) => g.nodes.length || groups.some((h) => h.parent === g.id)) };
}

// ------------------------------------------------------------------------------- entry point

const ACTIVITY = /^(?:start|stop|end|:[^:]*$|:.*;$|#\w+:|if\s*\(|while\s*\(|repeat\b|fork$|split$|partition\b|switch\s*\(|\|[^|]+\|$|\(\*\))/i;
const STATE = /\[\*\]|^state\s/i;
/** Class diagrams: their own keywords (an `interface` only with a body: component diagrams have bodiless ones) or UML relation ends. */
const CLASS = /^(?:abstract|class|enum|annotation|struct|protocol|exception|metaclass)\b|^interface\b.*\{$|<\|--|--\|>|\.\.\|>|<\|\.\.|\*--|--\*|o--|--o\b/;

/** Reads PlantUML source (`@startuml` … `@enduml`, or just the statements). Throws a LayoutError naming the line. */
export function parsePlantUml(source: string): PlantUmlDiagram {
  const { stmts, direction, title } = statements(source);
  if (isSequence(stmts)) return { kind: 'sequence', diagram: parseSequence(stmts, title) };
  if (stmts.some((s) => ACTIVITY.test(s.text) && !/^:[^:]+:(?:\s|$)/.test(s.text))) return parseActivity(stmts, direction);
  if (stmts.some((s) => STATE.test(s.text))) return parseState(stmts, direction);
  if (stmts.some((s) => CLASS.test(s.text))) return parseClass(stmts, direction);
  return parseDescription(stmts, direction);
}

// ------------------------------------------------------------------------------- layout

/**
 * Lays a PlantUML diagram out from (0, 0): a sequence with `layoutSequence`, everything else with
 * `layoutDiagram` (the layered layout whose nodes carry their size and look, edges their UML ends
 * and end labels) — the function Mermaid's class, ER and state diagrams use.
 */
export function layoutPlantUml(d: PlantUmlDiagram, ctx: LayoutContext): LaidOut {
  return d.kind === 'sequence' ? layoutSequence(d.diagram, ctx) : layoutDiagram(d.nodes, d.edges, d.direction, d.groups, ctx);
}
