// Turning a structure into a change of ONE board, given the board as the actor sees it: lay it out
// (@freero/shared layout), place it on free space (never on existing content), and express it as
// a BoardChange — new elements, moved items, table cells. Pure, so the same plan feeds every sink
// (sinks.ts): the board itself, a preview, and later the suggestions layer (KAI-169).
import {
  layoutStructure,
  LayoutError,
  placeLaidOut,
  rotatedBounds,
  tableCellEntries,
  type BoardElement,
  type InsertStructureRequest,
  type LaidOut,
  type Point,
  type Rect,
} from '@freero/shared';
import type { BoardChange, BoardView } from '../realtime/index';

/** Kinds of existing items a structure may move into place (loose items, not containers or lines). */
const MOVABLE = new Set(['sticky', 'card', 'shape', 'text', 'image', 'emoji', 'icon', 'embed', 'pdf']);
const GAP = 48;

export interface Plan {
  change: BoardChange;
  placed: LaidOut & { bounds: Rect };
}

export function planStructure(req: InsertStructureRequest, view: BoardView, newId: () => string): Plan {
  const byId = new Map(view.elements.map((e) => [e.el.id, e.el]));
  const laid = layoutStructure(req.structure, {
    newId,
    existing: (id) => {
      const el = byId.get(id);
      if (!el) return undefined;
      if (!MOVABLE.has(el.type)) throw new LayoutError(`Item ${id} is a ${el.type}; only loose items (stickies, cards, shapes, text …) can be moved into clusters`);
      if (el.locked) throw new LayoutError(`Item ${id} is locked`);
      return { type: el.type, w: el.w, h: el.h };
    },
  });
  // What moves comes along with its riders (reaction stamps), like a drag.
  const moving = new Set(laid.moves.map((m) => m.id));
  const riders = view.elements.filter((e) => e.el.attachedTo && moving.has(e.el.attachedTo)).map((e) => e.el);
  const travelling = new Set([...moving, ...riders.map((r) => r.id)]);
  const obstacles = view.elements.filter((e) => !travelling.has(e.el.id)).map((e) => rotatedBounds(e.el));

  let near: Point | undefined = req.at;
  if (req.near) {
    const x = byId.get(req.near);
    if (!x) throw new LayoutError(`No item ${req.near} on this board`);
    // Just right of it, vertically centered on it: the nearest free spot from there.
    near = { x: x.x + x.w + GAP + laid.size.w / 2, y: x.y + x.h / 2 };
  }
  const placed = placeLaidOut(laid, { obstacles, near, gap: GAP });

  const update: NonNullable<BoardChange['update']> = [];
  for (const m of placed.moves) {
    const el = byId.get(m.id)!;
    const dx = m.x - el.x;
    const dy = m.y - el.y;
    // Placed on free space, outside every frame: it leaves the frame it was in (the drop rule).
    update.push({ id: m.id, patch: { x: m.x, y: m.y, frameId: null } });
    for (const r of riders) if (r.attachedTo === m.id) update.push({ id: r.id, patch: { x: r.x + dx, y: r.y + dy, frameId: null } });
  }
  const cells: Record<string, string> = {};
  for (const [tableId, content] of Object.entries(placed.content)) Object.assign(cells, tableCellEntries(tableId, content));
  return {
    change: {
      create: placed.elements,
      update,
      ...(Object.keys(cells).length ? { collections: { tableCells: cells } } : {}),
    },
    placed,
  };
}

/** A placed draft as a full element (preview snapshots: the app's insertElements restamps these). */
export const asElement = (d: Plan['placed']['elements'][number], userId: string, now: number): BoardElement =>
  ({ ...d, z: 0, createdBy: userId, createdAt: now, updatedAt: now }) as BoardElement;
