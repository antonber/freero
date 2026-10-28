// Builds the board outline (types.ts) from what ONE reader can see. Pure: the caller decides
// what that is (the server: the shared doc plus the layers the reader may read), and the
// features' outline.ts files (define.ts) say how each element type reads.
import type { BoardElement, ElementType } from '../elements';
import { actingFor, mentionsAsNames } from '../elements';
import { rotatedBounds, unionRects, type Rect } from '../geometry';
import { richTextToPlain } from '../text';
import type { OutlineContext, OutlineDescription, OutlineFeature, OutlineKindFn } from './define';
import { clusterBoxes, readingOrder } from './spatial';
import type { SuggestionRecord, SuggestionState } from '../suggestions';
import { OUTLINE_VERSION, type BoardOutline, type OutlineEdge, type OutlineItem, type OutlineSuggestion, type OutlineThread } from './types';

export type OutlineLayer = 'shared' | 'editors' | 'private';

export interface OutlineSource {
  board: { id: string; title: string; url?: string };
  /** Opaque token that changes whenever anything below changes. */
  version: string;
  readerId: string;
  /** The reader may see hidden frames' contents (owners and editors). */
  seesHidden: boolean;
  /** Every element the reader can see, with the layer it lives in. */
  elements: Array<{ el: BoardElement; layer: OutlineLayer }>;
  /** A collection of the shared doc. */
  collection(name: string): ReadonlyMap<string, unknown>;
  personName(userId: string): string | undefined;
}

export interface OutlineBuildOptions {
  /** Item authors (creator names). Default false: they cost tokens and rarely matter. */
  authors?: boolean;
  /** Comment threads. Default true. */
  comments?: boolean;
}

/** One node of the tree being built: an item plus what it is laid out from. */
interface Node {
  item: OutlineItem;
  bounds: Rect | null;
  standalone: boolean;
  el?: BoardElement;
  desc?: OutlineDescription;
  kids: Node[];
}

const EMPTY = new Map<string, never>();

/** Merges the features' element kinds; two features describing one type is a bug. */
export function outlineKinds(features: OutlineFeature[]): Map<ElementType, OutlineKindFn<ElementType>> {
  const out = new Map<ElementType, OutlineKindFn<ElementType>>();
  for (const f of features)
    for (const [type, fn] of Object.entries(f.kinds ?? {}) as Array<[ElementType, OutlineKindFn<ElementType>]>) {
      if (out.has(type)) throw new Error(`Two features describe the outline of '${type}' elements`);
      out.set(type, fn);
    }
  return out;
}

function cleanFields(f: OutlineDescription['fields']): Record<string, string | number | boolean> | undefined {
  if (!f) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(f)) if (v !== null && v !== undefined && v !== '') out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Longest text an item carries (a pasted essay in a text box would swamp any budget). */
export const MAX_ITEM_TEXT = 4000;

const nonEmpty = (s: string | undefined) => (s && s.trim() ? (s.length > MAX_ITEM_TEXT ? `${s.slice(0, MAX_ITEM_TEXT)}…` : s) : undefined);

function contextOf(source: OutlineSource, elements: BoardElement[], visible: Map<string, { el: BoardElement }>): OutlineContext {
  return {
    readerId: source.readerId,
    elements: () => elements,
    element: (id) => visible.get(id)?.el,
    collection: <T>(name: string) => (source.collection(name) ?? EMPTY) as ReadonlyMap<string, T>,
    mentions: (text) => mentionsAsNames(text, source.personName),
    plain: (html) => mentionsAsNames(richTextToPlain(html), source.personName),
    personName: source.personName,
  };
}

/**
 * Pending suggestions (KAI-169) as the outline lists them: each suggested item read the way its
 * feature describes it (the item as it would be once accepted; a deletion: the item it deletes).
 */
export function describeSuggestions(
  source: OutlineSource,
  features: OutlineFeature[],
  list: ReadonlyArray<{ record: SuggestionRecord; element: BoardElement | null; state: SuggestionState }>,
): OutlineSuggestion[] {
  const kinds = outlineKinds(features);
  const elements = source.elements.map((e) => e.el);
  const ctx = contextOf(source, elements, new Map(source.elements.map((e) => [e.el.id, e])));
  return list.map(({ record: r, element, state }) => {
    const out: OutlineSuggestion = {
      id: r.id,
      groupId: r.groupId,
      op: r.op,
      itemId: r.op === 'create' ? (r.element?.id ?? '') : (r.targetId ?? ''),
      by: r.author.kind === 'person' ? r.author.name : `${r.author.name} for ${r.author.userName}`,
      state,
    };
    const description = nonEmpty(r.description);
    if (description) out.description = description;
    if (r.op === 'update') out.changes = Object.keys(r.patch ?? {}).sort();
    if (element) {
      const fn = kinds.get(element.type);
      const desc = fn ? fn(element as never, ctx) : {};
      out.kind = desc?.kind ?? element.type;
      const title = nonEmpty(desc?.title);
      const text = nonEmpty(desc?.text ?? desc?.edge?.label);
      if (title) out.title = title;
      if (text) out.text = text;
    }
    return out;
  });
}

export function buildOutline(source: OutlineSource, features: OutlineFeature[], opts: OutlineBuildOptions = {}): BoardOutline {
  const kinds = outlineKinds(features);
  const visible = new Map(source.elements.map((e) => [e.el.id, e]));
  const elements = source.elements.map((e) => e.el);
  const ctx = contextOf(source, elements, visible);

  // 1. How each element reads.
  const nodes = new Map<string, Node>();
  const edgeEls: Array<{ el: BoardElement; edge: NonNullable<OutlineDescription['edge']> }> = [];
  for (const { el, layer } of source.elements) {
    const fn = kinds.get(el.type);
    const desc = fn ? fn(el as never, ctx) : {};
    if (!desc) continue;
    if (desc.edge) {
      edgeEls.push({ el, edge: desc.edge });
      continue;
    }
    const item: OutlineItem = { id: el.id, kind: desc.kind ?? el.type };
    if (desc.variant) item.variant = desc.variant;
    const title = nonEmpty(desc.title);
    const text = nonEmpty(desc.text);
    if (title) item.title = title;
    if (text) item.text = text;
    const fields = cleanFields(desc.fields);
    if (fields) item.fields = fields;
    if (desc.rows?.length) item.rows = desc.rows;
    if (el.link) item.link = el.link;
    if (opts.authors) {
      const name = source.personName(el.createdBy);
      // Made by an app for that person (the API, MCP; KAI-168): "Claude for Maria".
      const via = el.createdVia && typeof el.createdVia.name === 'string' ? el.createdVia : null;
      if (name) item.author = via ? actingFor(via, name) : name;
    }
    if (layer === 'private') item.private = true;
    if (desc.hidden) {
      item.hidden = true;
      if (!source.seesHidden) item.withheld = true;
    }
    nodes.set(el.id, { item, bounds: rotatedBounds(el), standalone: !!desc.standalone, el, desc, kids: [] });
  }

  // 2. Where each item sits: on an item it rides on, under its tree parent, in a section of its
  // container, in its container, or at the top.
  const root: Node[] = [];
  const sections = new Map<string, Map<string, Node>>();
  const sectionNodes = (container: Node): Map<string, Node> | null => {
    const list = container.desc?.sections;
    if (!list) return null;
    let made = sections.get(container.item.id);
    if (!made) {
      made = new Map();
      for (const s of list) {
        const item: OutlineItem = { id: `${container.item.id}:${s.id}`, kind: 'column' };
        const title = nonEmpty(s.title);
        if (title) item.title = title;
        const fields = cleanFields(s.fields);
        if (fields) item.fields = fields;
        const node: Node = { item, bounds: null, standalone: true, kids: [] };
        made.set(s.id, node);
        container.kids.push(node);
      }
      sections.set(container.item.id, made);
    }
    return made;
  };
  /** The tree parent, unless following parents leads back to `id` (malformed maps). */
  const treeParent = (n: Node): Node | null => {
    const pid = n.desc?.parentId;
    if (!pid) return null;
    const seen = new Set([n.item.id]);
    for (let cur: string | null | undefined = pid; cur; cur = nodes.get(cur)?.desc?.parentId) {
      if (seen.has(cur)) return null;
      seen.add(cur);
      if (!nodes.has(cur)) break;
    }
    return nodes.get(pid) ?? null;
  };
  const frameParents = new Set<string>();
  for (const n of nodes.values()) {
    const el = n.el!;
    const rider = el.attachedTo ? nodes.get(el.attachedTo) : undefined;
    const tree = rider ? null : treeParent(n);
    if (rider && rider !== n) rider.kids.push(n);
    else if (tree) tree.kids.push(n);
    else {
      const container = el.frameId ? nodes.get(el.frameId) : undefined;
      if (container && container !== n) {
        const secs = sectionNodes(container);
        const sid = secs ? container.desc!.sectionOf?.(el) : null;
        const sec = sid ? secs!.get(sid) : undefined;
        (sec ?? container).kids.push(n);
        frameParents.add(container.item.id);
      } else root.push(n);
    }
  }
  // Containers that hold nothing still show their (empty) sections.
  for (const n of nodes.values()) if (n.desc?.sections) sectionNodes(n);

  // 3. Explicit groups, then proximity clusters, in the board and in frames-like containers.
  // Items a connector joins belong together too (a flowchart).
  const joined = new Map<string, string[]>();
  for (const { edge } of edgeEls) {
    if (!edge.from || !edge.to || !nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    joined.set(edge.from, [...(joined.get(edge.from) ?? []), edge.to]);
  }
  const arrange = (list: Node[], cluster: boolean): Node[] => {
    let out = list;
    const groups = new Map<string, Node[]>();
    for (const n of out) {
      const g = n.el?.groupId;
      if (g) groups.set(g, [...(groups.get(g) ?? []), n]);
    }
    for (const [g, members] of groups) {
      if (members.length < 2) continue;
      const gn: Node = {
        item: { id: `group:${g}`, kind: 'group' },
        bounds: unionBounds(members),
        standalone: true,
        kids: readingOrder(members, (m) => m.bounds),
      };
      out = [...out.filter((n) => !members.includes(n)), gn];
    }
    if (cluster) out = clusterNodes(out, joined);
    return readingOrder(out, (n) => n.bounds);
  };
  const visit = (n: Node) => {
    // Kanban columns keep their own order (top to bottom); sections in declared order.
    if (n.item.kind === 'column') n.kids = [...n.kids].sort((a, b) => (a.bounds?.y ?? 0) - (b.bounds?.y ?? 0));
    else if (!n.desc?.sections) n.kids = arrange(n.kids, frameParents.has(n.item.id));
    else n.kids = [...n.kids.filter((k) => k.item.kind === 'column'), ...arrange(n.kids.filter((k) => k.item.kind !== 'column'), false)];
    n.kids.forEach(visit);
  };
  const top = arrange(root, true);
  top.forEach(visit);

  // 4. Edges between items the reader can see.
  const edges: OutlineEdge[] = [];
  const end = (id: string | null) => (id && nodes.has(id) ? id : null);
  for (const { el, edge } of readingOrder(edgeEls, (e) => rotatedBounds(e.el))) {
    const e: OutlineEdge = { id: el.id, from: end(edge.from), to: end(edge.to) };
    const label = nonEmpty(edge.label);
    if (label) e.label = label;
    if (edge.arrow && edge.arrow !== 'forward') e.arrow = edge.arrow;
    edges.push(e);
  }

  // 5. What the features' collections add.
  const boardComments: OutlineThread[] = [];
  const notes: string[] = [];
  for (const f of features) {
    if (!f.annotate) continue;
    const a = f.annotate(ctx);
    for (const [id, facts] of a.items ?? []) {
      const n = nodes.get(id);
      if (!n) {
        // Pinned to something the reader can't see: the thread stays, the pin doesn't.
        if (facts.comments) boardComments.push(...facts.comments);
        continue;
      }
      if (facts.votes) n.item.votes = (n.item.votes ?? 0) + facts.votes;
      if (facts.tags?.length) n.item.tags = [...(n.item.tags ?? []), ...facts.tags];
      if (facts.comments?.length) n.item.comments = [...(n.item.comments ?? []), ...facts.comments];
    }
    boardComments.push(...(a.comments ?? []));
    notes.push(...(a.notes ?? []));
  }
  if (opts.comments === false) {
    for (const n of nodes.values()) delete n.item.comments;
    boardComments.length = 0;
  }

  // 6. Freeze the tree.
  let itemCount = 0;
  const freeze = (n: Node): OutlineItem => {
    itemCount++;
    if (n.kids.length) n.item.children = n.kids.map(freeze);
    return n.item;
  };
  const items = top.map(freeze);
  return {
    outlineVersion: OUTLINE_VERSION,
    board: source.board,
    version: source.version,
    items,
    edges,
    comments: boardComments,
    notes,
    meta: { itemCount, edgeCount: edges.length, returned: itemCount + edges.length, truncated: false, omitted: 0 },
  };
}

const unionBounds = (nodes: Node[]): Rect | null => unionRects(nodes.flatMap((n) => (n.bounds ? [n.bounds] : [])));

/**
 * Items that sit close together become a cluster (what people mean by "these stickies belong
 * together"). A text box right above the rest of its cluster is its title.
 */
function clusterNodes(list: Node[], joined: ReadonlyMap<string, string[]>): Node[] {
  const candidates = list.filter((n) => !n.standalone && n.bounds);
  if (candidates.length < 2) return list;
  const index = new Map(candidates.map((n, i) => [n.item.id, i]));
  const links: Array<[number, number]> = [];
  for (const [a, tos] of joined)
    for (const b of tos) if (index.has(a) && index.has(b)) links.push([index.get(a)!, index.get(b)!]);
  const groups = clusterBoxes(
    candidates.map((n) => n.bounds!),
    links,
  );
  // One cluster holding everything says nothing.
  if (groups.length === 1 && groups[0].length === candidates.length && candidates.length === list.length) return list;
  const out = list.filter((n) => n.standalone || !n.bounds);
  for (const g of groups) {
    const members = g.map((i) => candidates[i]);
    if (members.length < 2) {
      out.push(members[0]);
      continue;
    }
    const ordered = readingOrder(members, (m) => m.bounds);
    const titleNode = clusterTitle(ordered);
    const kids = titleNode ? ordered.filter((m) => m !== titleNode) : ordered;
    const item: OutlineItem = { id: `cluster:${(titleNode ?? ordered[0]).item.id}`, kind: 'cluster' };
    if (titleNode) item.title = titleNode.item.text;
    const variants = new Set(kids.map((k) => `${k.item.kind}/${k.item.variant ?? ''}`));
    if (variants.size === 1 && kids[0].item.variant) item.variant = kids[0].item.variant;
    out.push({ item, bounds: unionBounds(members), standalone: true, kids });
  }
  return out;
}

function clusterTitle(members: Node[]): Node | null {
  const texts = members.filter((m) => m.item.kind === 'text' && m.item.text && !m.kids.length);
  if (texts.length === 0 || members.length - texts.length < 1) return null;
  const others = members.filter((m) => m.item.kind !== 'text');
  const topOfOthers = Math.min(...others.map((m) => m.bounds!.y));
  const above = texts.filter((t) => t.bounds!.y + t.bounds!.h <= topOfOthers + 4);
  if (above.length !== 1) return null;
  return above[0].item.text!.length <= 120 ? above[0] : null;
}
