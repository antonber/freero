// Auto-layout of a selected diagram (KAI-118): the selected items and the connectors joining them
// as a graph, laid out by @freero/shared's layouts — the layered layout layout-from-structure
// draws flowcharts with, or the tidy tree it draws org charts with — so a diagram tidied here
// looks like one inserted from text. Pure planning plus the glue that applies it as one undo step.
import { layered, tidyTree, type BoardElement, type ConnectorElement } from '@freero/shared';
import type { Editor } from '@engine';
import { applyMoves, selectedUnits, type Move, type Unit } from './arrange';

export type AutoLayoutMode = 'down' | 'right' | 'tree' | 'orgchart';

/** Edges between units: connectors attached at both ends to members of two different units. */
export function unitEdges(units: Unit[], connectors: ConnectorElement[]): Array<{ from: string; to: string }> {
  const unitOf = new Map<string, number>();
  units.forEach((u, i) => u.ids.forEach((id) => unitOf.set(id, i)));
  const out: Array<{ from: string; to: string }> = [];
  for (const c of connectors) {
    const a = c.start.elementId ? unitOf.get(c.start.elementId) : undefined;
    const b = c.end.elementId ? unitOf.get(c.end.elementId) : undefined;
    if (a === undefined || b === undefined || a === b) continue;
    out.push({ from: `u${a}`, to: `u${b}` });
  }
  return out;
}

/**
 * Where each movable unit goes. Locked units stay put and are left out of the graph; the laid-out
 * drawing keeps the top-left of the units it moves.
 */
export function planAutoLayout(units: Unit[], connectors: ConnectorElement[], mode: AutoLayoutMode): Move[] {
  const free = units.filter((u) => !u.locked);
  if (free.length < 2) return [];
  const nodes = free.map((u) => ({ id: `u${units.indexOf(u)}`, w: u.box.w, h: u.box.h }));
  const known = new Set(nodes.map((n) => n.id));
  const edges = unitEdges(units, connectors).filter((e) => known.has(e.from) && known.has(e.to));
  const pos =
    mode === 'down' || mode === 'right'
      ? layered(nodes, edges, { direction: mode === 'down' ? 'TB' : 'LR', nodeSep: 56, rankSep: 72 }).pos
      : tidyTree(nodes, edges, { direction: mode === 'orgchart' ? 'TB' : 'LR', siblingGap: mode === 'orgchart' ? 32 : 20, levelGap: mode === 'orgchart' ? 64 : 72 }).pos;
  const origin = { x: Math.min(...free.map((u) => u.box.x)), y: Math.min(...free.map((u) => u.box.y)) };
  const out: Move[] = [];
  for (const u of free) {
    const p = pos.get(`u${units.indexOf(u)}`);
    if (!p) continue;
    const dx = Math.round(origin.x + p.x - u.box.x);
    const dy = Math.round(origin.y + p.y - u.box.y);
    if (dx || dy) out.push({ ids: u.ids, dx, dy });
  }
  return out;
}

const connectorsOf = (editor: Editor): ConnectorElement[] => editor.getElements().filter((e: BoardElement): e is ConnectorElement => e.type === 'connector');

/** Units of the selection that connectors join (at least one line between two of them). */
export const hasDiagram = (editor: Editor): boolean => {
  const units = selectedUnits(editor);
  return units.filter((u) => !u.locked).length >= 2 && unitEdges(units, connectorsOf(editor)).length > 0;
};

export function autoLayout(editor: Editor, mode: AutoLayoutMode): void {
  applyMoves(editor, planAutoLayout(selectedUnits(editor), connectorsOf(editor), mode));
}
