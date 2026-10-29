// Layout from structure: `layoutStructure` turns what a caller means into elements laid out from
// (0, 0); `placeLaidOut` moves that block onto free space of a board (findFreeSpot), so nothing
// lands on existing content.
import { STICKY_COLORS, type StickyColor } from '../elements';
import { findFreeSpot, unionRects, type Point, type Rect } from '../geometry';
import { translateDraft } from './kit';
import { layoutItems } from './items';
import { parseMermaid } from './mermaid';
import { layoutClusters, layoutGraph, layoutKanban, layoutMindmap, layoutNote, layoutOrgChart, layoutSequence, layoutStickies, layoutTable, layoutTree, parseIndentedList } from './structures';
import { LayoutError, type LaidOut, type LayoutContext, type OutlineNodeInput, type StructureInput } from './types';

export * from './types';
export { parseMermaid, looksLikeMermaid, type MermaidDiagram } from './mermaid';
export { parseIndentedList, parseOrgRows, columnStatus } from './structures';
export * from './mindtree';
export * as timelineLayout from './timeline';
export { tidyTree, type TidyUnit, type TidyOptions } from './tidy';
export { layered, spacedFit } from './layered';
export { measureText, textWidth } from './measure';
export { translateDraft } from './kit';
// Single fully-specified drafts (the public API creates items one by one with them).
export {
  sticky as stickyDraft,
  shape as shapeDraft,
  textBox as textDraft,
  frame as frameDraft,
  connector as connectorDraft,
  anchorPoint,
  STICKY_SIZE,
  INK,
  type ConnectorEnd,
  type ConnectorStyle,
} from './kit';

const isColor = (c: unknown): c is StickyColor => typeof c === 'string' && c in STICKY_COLORS;
const isDirection = (d: unknown) => d === undefined || d === 'TB' || d === 'BT' || d === 'LR' || d === 'RL';

function outlineRoot(text: string): OutlineNodeInput {
  const roots = parseIndentedList(text);
  if (!roots.length) throw new LayoutError('The outline is empty');
  return roots.length === 1 ? roots[0] : { text: 'Outline', children: roots };
}

/** Lays `input` out from (0, 0). Throws a LayoutError (a message fit for the caller) on bad input. */
export function layoutStructure(input: StructureInput, ctx: LayoutContext): LaidOut {
  if (!input || typeof input !== 'object') throw new LayoutError('Missing structure');
  switch (input.kind) {
    case 'mindmap':
      return layoutMindmap(input.root, ctx);
    case 'tree':
      if (!isDirection(input.direction)) throw new LayoutError('direction must be TB, BT, LR or RL');
      return layoutTree(input.root, input.direction ?? 'TB', ctx);
    case 'outline': {
      if (typeof input.text !== 'string') throw new LayoutError('An outline needs its text');
      const root = outlineRoot(input.text);
      return input.as === 'tree' ? layoutTree(root, 'TB', ctx) : layoutMindmap(root, ctx);
    }
    case 'stickies':
      if (!Array.isArray(input.items) || !input.items.length || input.items.some((t) => typeof t !== 'string'))
        throw new LayoutError('stickies needs a non-empty list of texts');
      if (input.color !== undefined && !isColor(input.color)) throw new LayoutError(`Unknown sticky color ${String(input.color)}`);
      return layoutStickies(input.items, input.title, input.color ?? 'yellow', ctx);
    case 'clusters':
      if (!Array.isArray(input.clusters) || !input.clusters.length) throw new LayoutError('clusters needs at least one cluster');
      for (const c of input.clusters) {
        if (!c || !Array.isArray(c.items)) throw new LayoutError('Every cluster needs items');
        if (c.color !== undefined && !isColor(c.color)) throw new LayoutError(`Unknown sticky color ${String(c.color)}`);
        if (c.items.some((i) => typeof i !== 'string' && (typeof i !== 'object' || !i || typeof i.id !== 'string')))
          throw new LayoutError('A cluster item is a text or { id } of an item on the board');
      }
      return layoutClusters(input.clusters, ctx);
    case 'graph':
      if (!Array.isArray(input.nodes) || !Array.isArray(input.edges ?? [])) throw new LayoutError('graph needs nodes and edges');
      if (!isDirection(input.direction)) throw new LayoutError('direction must be TB, BT, LR or RL');
      return layoutGraph(input.nodes, input.edges ?? [], input.direction ?? 'TB', input.groups ?? [], ctx);
    case 'mermaid': {
      const d = parseMermaid(input.source);
      if (d.kind === 'mindmap') return layoutMindmap(d.root, ctx);
      return d.kind === 'sequence' ? layoutSequence(d.diagram, ctx) : layoutGraph(d.nodes, d.edges, d.direction, d.groups, ctx);
    }
    case 'sequence':
      return layoutSequence(input.diagram, ctx);
    case 'table':
      if (!Array.isArray(input.rows) || input.rows.some((r) => !Array.isArray(r))) throw new LayoutError('table needs rows of cells');
      return layoutTable(input.rows, input.header !== false, ctx);
    case 'note':
      if (typeof input.text !== 'string' || !input.text.trim()) throw new LayoutError('A note needs its text');
      if (input.title !== undefined && typeof input.title !== 'string') throw new LayoutError('A note title is text');
      return layoutNote(input.title, input.text, ctx);
    case 'kanban':
      if (input.title !== undefined && typeof input.title !== 'string') throw new LayoutError('A kanban title is text');
      return layoutKanban(input.title, input.columns, ctx);
    case 'orgchart':
      return layoutOrgChart(input.people, ctx);
    case 'items':
      if (!Array.isArray(input.items)) throw new LayoutError('items needs a list of items');
      if (input.layout !== undefined && input.layout !== 'grid' && input.layout !== 'kanban') throw new LayoutError('layout must be grid or kanban');
      return layoutItems(input.items, input.layout ?? 'grid', input.title, ctx);
    default:
      throw new LayoutError(`Unknown structure kind ${String((input as { kind?: unknown }).kind)}`);
  }
}

export interface Placement {
  /** Every element on the board the result must stay clear of. */
  obstacles: Rect[];
  /** Where the result's center should be, as near as free space allows. Default: the middle of the board's content. */
  near?: Point;
  /** Clear space kept around it (world units). Default 48. */
  gap?: number;
}

/** `laid` moved onto the free spot nearest `near`; returns it with its final bounds. */
export function placeLaidOut(laid: LaidOut, p: Placement): LaidOut & { bounds: Rect } {
  const content = unionRects(p.obstacles);
  const near = p.near ?? (content ? { x: content.x + content.w / 2, y: content.y + content.h / 2 } : { x: 0, y: 0 });
  const spot = findFreeSpot(p.obstacles, laid.size, near, p.gap ?? 48);
  return {
    elements: laid.elements.map((el) => translateDraft(el, spot.x, spot.y)),
    content: laid.content,
    moves: laid.moves.map((m) => ({ id: m.id, x: m.x + spot.x, y: m.y + spot.y })),
    size: laid.size,
    ...(laid.keys ? { keys: laid.keys } : {}),
    bounds: { x: spot.x, y: spot.y, w: laid.size.w, h: laid.size.h },
  };
}
