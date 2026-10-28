// A Mermaid reader for the subset that maps onto board elements: flowcharts (node shapes, edge
// chains with labels and styles, `&`, subgraphs) and sequence diagrams (participants, messages,
// notes). Written in-house: Mermaid's own parser drags in its renderer. Styling directives are
// skipped; anything else unknown is an error naming the line, so nothing is silently dropped.
import type { ShapeKind } from '../elements';
import type { Direction, GraphEdgeInput, GraphGroupInput, GraphNodeInput, SequenceInput } from './types';
import { LAYOUT_LIMITS, LayoutError } from './types';

export type MermaidDiagram =
  | { kind: 'graph'; direction: Direction; nodes: GraphNodeInput[]; edges: GraphEdgeInput[]; groups: GraphGroupInput[] }
  | { kind: 'sequence'; diagram: SequenceInput };

const IGNORED = /^(style|classDef|class|click|linkStyle|accTitle|accDescr|direction)\b/;

const fail = (line: number, msg: string): never => {
  throw new LayoutError(`Mermaid line ${line}: ${msg}`);
};

/** Mermaid label text: quotes, markdown backticks and <br> handled; entities like #quot; decoded. */
function label(raw: string): string {
  let t = raw.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('`') && t.endsWith('`'))) t = t.slice(1, -1);
  if (t.startsWith('`') && t.endsWith('`')) t = t.slice(1, -1);
  return t
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/#quot;/g, '"')
    .replace(/#amp;/g, '&')
    .replace(/#lt;/g, '<')
    .replace(/#gt;/g, '>')
    .replace(/#35;/g, '#')
    .trim();
}

/** Brackets around a node's text, longest openers first. */
const SHAPES: Array<[string, string, ShapeKind]> = [
  ['(((', ')))', 'ellipse'],
  ['((', '))', 'ellipse'],
  ['([', '])', 'terminator'],
  ['[[', ']]', 'predefinedProcess'],
  ['[(', ')]', 'cylinder'],
  ['{{', '}}', 'hexagon'],
  ['[/', '/]', 'parallelogram'],
  ['[\\', '\\]', 'parallelogram'],
  ['[/', '\\]', 'trapezoid'],
  ['[\\', '/]', 'trapezoid'],
  ['(', ')', 'roundRect'],
  ['[', ']', 'rect'],
  ['{', '}', 'diamond'],
  ['>', ']', 'rect'],
];

const ID_RE = /^[A-Za-z0-9_À-￿][\wÀ-￿.$-]*/;

interface Cursor {
  s: string;
  i: number;
  line: number;
}

const ws = (c: Cursor) => {
  while (c.i < c.s.length && /\s/.test(c.s[c.i])) c.i++;
};

/** `id`, optionally followed by a bracketed text, optionally `:::class`. */
function readNode(c: Cursor): { id: string; text?: string; shape?: ShapeKind } {
  ws(c);
  const rest = c.s.slice(c.i);
  // An id never ends in '-' or '.' right before a link ("A-->B").
  let id = ID_RE.exec(rest)?.[0];
  if (!id) return fail(c.line, `expected a node at "${rest.slice(0, 30)}"`);
  while (/[-.]$/.test(id) && /^[-.=]/.test(rest.slice(id.length - 1))) id = id.slice(0, -1);
  if (!id) return fail(c.line, `expected a node at "${rest.slice(0, 30)}"`);
  c.i += id.length;
  let out: { id: string; text?: string; shape?: ShapeKind } = { id };
  for (const [open, close, shape] of SHAPES) {
    if (!c.s.startsWith(open, c.i)) continue;
    const from = c.i + open.length;
    // Quoted text may contain the closer.
    let to: number;
    const q = c.s.slice(from).match(/^\s*"/);
    if (q) {
      const endQuote = c.s.indexOf('"', from + q[0].length);
      if (endQuote < 0) return fail(c.line, 'unclosed quote');
      to = c.s.indexOf(close, endQuote);
    } else to = c.s.indexOf(close, from);
    if (to < 0) continue;
    out = { id, text: label(c.s.slice(from, to)), shape };
    c.i = to + close.length;
    break;
  }
  const cls = /^:::[\w-]+/.exec(c.s.slice(c.i));
  if (cls) c.i += cls[0].length;
  return out;
}

interface Link {
  label?: string;
  style: 'solid' | 'dashed' | 'thick';
  arrow: 'forward' | 'both' | 'none';
}

const INLINE_LINK = /^\s*(<?)(--|==|-\.)\s+(.+?)\s+(-{2,}[>xo]?|={2,}[>xo]?|\.-+[>xo]?|-{3,}|={3,})(?=\s|[A-Za-z0-9_"]|$)/;
const LINK = /^\s*(<?)(-{2,}|={2,}|-\.+-)(>|[xo](?=\s|$))?/;

function readLink(c: Cursor): Link | null {
  const rest = c.s.slice(c.i);
  const inline = INLINE_LINK.exec(rest);
  if (inline) {
    c.i += inline[0].length;
    const close = inline[4];
    const kind = inline[2];
    return {
      label: label(inline[3]),
      style: kind === '==' ? 'thick' : kind === '-.' ? 'dashed' : 'solid',
      arrow: /[>xo]$/.test(close) ? (inline[1] ? 'both' : 'forward') : 'none',
    };
  }
  const m = LINK.exec(rest);
  if (!m) return null;
  c.i += m[0].length;
  const body = m[2];
  const link: Link = {
    style: body.startsWith('=') ? 'thick' : body.includes('.') ? 'dashed' : 'solid',
    arrow: m[3] ? (m[1] ? 'both' : 'forward') : 'none',
  };
  const pipe = /^\s*\|([^|]*)\|/.exec(c.s.slice(c.i));
  if (pipe) {
    link.label = label(pipe[1]);
    c.i += pipe[0].length;
  }
  return link;
}

function splitStatements(source: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  source.split(/\r\n?|\n/).forEach((raw, i) => {
    const noComment = raw.replace(/%%.*$/, '');
    // `;` ends a statement unless it is inside quotes or brackets.
    let depth = 0;
    let quote = false;
    let start = 0;
    for (let k = 0; k < noComment.length; k++) {
      const ch = noComment[k];
      if (ch === '"') quote = !quote;
      else if (!quote && '[({'.includes(ch)) depth++;
      else if (!quote && '])}'.includes(ch)) depth = Math.max(0, depth - 1);
      else if (!quote && depth === 0 && ch === ';') {
        out.push({ text: noComment.slice(start, k).trim(), line: i + 1 });
        start = k + 1;
      }
    }
    out.push({ text: noComment.slice(start).trim(), line: i + 1 });
  });
  return out.filter((s) => s.text);
}

export function parseMermaid(source: string): MermaidDiagram {
  if (typeof source !== 'string' || !source.trim()) throw new LayoutError('The Mermaid source is empty');
  if (source.length > LAYOUT_LIMITS.source) throw new LayoutError(`Mermaid source is longer than ${LAYOUT_LIMITS.source} characters`);
  const stmts = splitStatements(source).filter((s) => !/^---/.test(s.text));
  const head = stmts.shift();
  if (!head) throw new LayoutError('The Mermaid source is empty');
  if (/^sequenceDiagram\b/.test(head.text)) return { kind: 'sequence', diagram: parseSequence(stmts) };
  const m = /^(?:flowchart|graph)\b\s*(TB|TD|BT|RL|LR)?\s*(.*)$/i.exec(head.text);
  if (!m) return fail(head.line, `only flowcharts ("flowchart TD") and sequence diagrams are supported, not "${head.text.slice(0, 40)}"`);
  const dir = (m[1] ?? 'TB').toUpperCase();
  const direction: Direction = dir === 'TD' ? 'TB' : (dir as Direction);
  if (m[2]) stmts.unshift({ text: m[2], line: head.line });
  return { kind: 'graph', direction, ...parseFlowchart(stmts) };
}

function parseFlowchart(stmts: Array<{ text: string; line: number }>) {
  const nodes = new Map<string, GraphNodeInput>();
  const edges: GraphEdgeInput[] = [];
  const groups: GraphGroupInput[] = [];
  const stack: GraphGroupInput[] = [];
  /** Nodes given a text somewhere (an id only ever linked to may be a subgraph's). */
  const declared = new Set<string>();
  const touch = (n: { id: string; text?: string; shape?: ShapeKind }) => {
    if (n.text !== undefined) declared.add(n.id);
    if (groups.some((g) => g.id === n.id)) {
      if (n.text !== undefined) throw new LayoutError(`Mermaid: "${n.id}" is a subgraph and a node`);
      return; // a link to a subgraph
    }
    const prev = nodes.get(n.id);
    if (!prev) {
      if (nodes.size >= LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} nodes per diagram`);
      nodes.set(n.id, { id: n.id, text: n.text ?? n.id, shape: n.shape ?? 'rect' });
    } else if (n.text !== undefined) {
      prev.text = n.text;
      prev.shape = n.shape ?? prev.shape;
    }
    const g = stack[stack.length - 1];
    // A node belongs to the subgraph where it first appears (or is re-declared with a shape).
    if (g && (!prev || n.text !== undefined)) {
      for (const other of groups) other.nodes = other.nodes.filter((id) => id !== n.id);
      g.nodes.push(n.id);
    }
  };
  for (const { text, line } of stmts) {
    if (IGNORED.test(text)) continue;
    const sub = /^subgraph\s+(.*)$/.exec(text);
    if (sub) {
      const spec = sub[1].trim();
      const bracket = /^([^\s[]+)\s*\[(.*)\]$/.exec(spec);
      const id = bracket ? bracket[1] : /^[\w.-]+$/.test(spec) ? spec : `subgraph${groups.length + 1}`;
      const title = bracket ? label(bracket[2]) : label(spec);
      if (groups.some((g) => g.id === id) || declared.has(id)) fail(line, `subgraph id "${id}" is already used`);
      // Linked to before it was declared: that was the subgraph, not a node.
      if (nodes.delete(id)) for (const other of groups) other.nodes = other.nodes.filter((n) => n !== id);
      const g: GraphGroupInput = { id, title, nodes: [], parent: stack[stack.length - 1]?.id ?? null };
      groups.push(g);
      stack.push(g);
      continue;
    }
    if (text === 'end') {
      if (!stack.pop()) fail(line, '"end" without a subgraph');
      continue;
    }
    const c: Cursor = { s: text, i: 0, line };
    let left = [readNode(c)];
    ws(c);
    while (c.s.startsWith('&', c.i)) {
      c.i++;
      left.push(readNode(c));
      ws(c);
    }
    left.forEach(touch);
    while (c.i < c.s.length) {
      const link = readLink(c);
      if (!link) fail(line, `can't read "${c.s.slice(c.i, c.i + 30)}"`);
      const right = [readNode(c)];
      ws(c);
      while (c.s.startsWith('&', c.i)) {
        c.i++;
        right.push(readNode(c));
        ws(c);
      }
      right.forEach(touch);
      for (const a of left)
        for (const b of right) {
          if (edges.length >= LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} edges per diagram`);
          edges.push({ from: a.id, to: b.id, ...(link!.label ? { label: link!.label } : {}), style: link!.style, arrow: link!.arrow });
        }
      left = right;
    }
  }
  if (stack.length) throw new LayoutError(`Mermaid: subgraph "${stack[stack.length - 1].title}" has no "end"`);
  return { nodes: [...nodes.values()], edges, groups };
}

function parseSequence(stmts: Array<{ text: string; line: number }>): SequenceInput {
  const participants: SequenceInput['participants'] = [];
  const steps: SequenceInput['steps'] = [];
  let title: string | undefined;
  const known = new Map<string, SequenceInput['participants'][number]>();
  const ensure = (id: string, labelText?: string, actor?: boolean) => {
    let p = known.get(id);
    if (!p) {
      p = { id, label: labelText ?? id, ...(actor ? { actor: true } : {}) };
      known.set(id, p);
      participants.push(p);
    } else if (labelText) p.label = labelText;
    return p;
  };
  for (const { text, line } of stmts) {
    if (/^(autonumber|activate|deactivate|loop|alt|else|opt|par|and|critical|break|rect|end|option|box)\b/.test(text)) continue;
    const t = /^title\s*:?\s*(.*)$/.exec(text);
    if (t) {
      title = label(t[1]);
      continue;
    }
    const p = /^(participant|actor)\s+(\S+?)(?:\s+as\s+(.+))?$/.exec(text);
    if (p) {
      ensure(p[2], p[3] ? label(p[3]) : undefined, p[1] === 'actor');
      continue;
    }
    const note = /^note\s+(left of|right of|over)\s+([^:]+):\s*(.*)$/i.exec(text);
    if (note) {
      const over = note[2].split(',').map((s) => s.trim()).filter(Boolean);
      over.forEach((id) => ensure(id));
      const side = note[1].toLowerCase();
      steps.push({ kind: 'note', over, side: side === 'over' ? 'over' : side.startsWith('left') ? 'left' : 'right', text: label(note[3]) });
      continue;
    }
    const arrow = /(-->>|->>|--x|-x|--\)|-\)|-->|->)/.exec(text);
    const colon = text.indexOf(':');
    if (arrow && arrow.index > 0 && (colon < 0 || arrow.index < colon)) {
      const from = text.slice(0, arrow.index).trim();
      const after = text.slice(arrow.index + arrow[0].length);
      const colonAfter = after.indexOf(':');
      const to = (colonAfter >= 0 ? after.slice(0, colonAfter) : after).trim().replace(/^[+-]/, '').trim();
      const msg = colonAfter >= 0 ? label(after.slice(colonAfter + 1)) : '';
      if (!from || !to || /\s/.test(from) || /\s/.test(to)) fail(line, `can't read the message "${text.slice(0, 40)}"`);
      ensure(from);
      ensure(to);
      const op = arrow[0];
      steps.push({
        kind: 'message',
        from,
        to,
        text: msg,
        dashed: op.startsWith('--'),
        arrow: op.endsWith('>>') ? 'arrow' : op.endsWith('x') ? 'cross' : op.endsWith(')') ? 'open' : 'none',
      });
      if (steps.length > LAYOUT_LIMITS.elements) throw new LayoutError(`At most ${LAYOUT_LIMITS.elements} steps per diagram`);
      continue;
    }
    fail(line, `can't read "${text.slice(0, 40)}"`);
  }
  return { ...(title ? { title } : {}), participants, steps };
}
