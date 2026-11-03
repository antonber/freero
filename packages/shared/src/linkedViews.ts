// Linked views (docs/design/kanban-fields-and-views.md, step 3c): a `kanbanview` element shows a
// kanban that lives elsewhere on the same board — its cards as a table, a list, a calendar or a
// timeline — drawn from the live elements. Nothing is copied: the element stores the kanban's
// element id and one projection view (the same shape and rules as a kanban's own projection tab,
// tabs.ts), so every view of a collection reads the same cards and there is nothing to reconcile.
// Edits made in a linked view write the real cards (card.setValues), as a tab's do.
//
// Saved vs personal (owner decision 2), as for tabs: the element's `view` is what everyone starts
// from; each person's own changes (filter, sort, columns, grouping, date fields…) are a personal
// override under the element (key LINKED_VIEW_KEY) until an editor saves them for everyone.
//
// Read-time and deterministic: a malformed or unknown view reads as a table (the stored value is
// kept until someone saves); a source that is missing reads as none — deleted, or somewhere this
// reader can't see (a hidden frame, another person's draft). The view holds only ids, so a reader
// who can't see the kanban learns nothing of it from the view.
//
// Pure: the kanban feature, its outline and the server's add_view / configure_view read linked
// views only through here.
import type { BoardElement, KanbanElement, KanbanViewElement } from './elements';
import type { FieldDef } from './fields';
import { findFreeSpot, type Point, type Rect } from './geometry';
import type { ElementDraft } from './layout/types';
import { LAYOUT_NAMES, calendarDateField, cleanProjection, dateFields, listGroupField, timelineFields, type ProjectionLayout, type ProjectionView } from './tabs';
import { VIEW_LIMITS } from './views';

/** Personal view state key of a linked view's own settings (`Editor.getPersonalView(viewId, key)`). */
export const LINKED_VIEW_KEY = '_view';
/** The id a linked view's stored view carries (it has one view; the id only satisfies the tab shape). */
export const LINKED_VIEW_ID = 'view';

/** A new linked view's size per layout (world units): room for a month, a dozen rows, a few weeks of bars. */
export const LINKED_VIEW_SIZES: Record<ProjectionLayout, { w: number; h: number }> = {
  table: { w: 760, h: 440 },
  list: { w: 600, h: 440 },
  calendar: { w: 860, h: 640 },
  timeline: { w: 960, h: 440 },
};
export const LINKED_VIEW_MIN = { w: 320, h: 200 };
/** Its title band (name, "of <kanban>", buttons). */
export const LINKED_VIEW_HEAD_H = 44;
/** How far right of its kanban a new linked view is placed. */
export const LINKED_VIEW_GAP = 80;

const cache = new WeakMap<object, ProjectionView>();

/** Linked view `lv`'s saved view (anything malformed dropped; an unknown layout reads as a table). */
export function linkedView(lv: Pick<KanbanViewElement, 'view'>): ProjectionView {
  const raw = lv.view as unknown;
  const key = raw && typeof raw === 'object' ? raw : lv;
  const hit = cache.get(key);
  if (hit) return hit;
  const v = (raw && typeof raw === 'object' ? cleanProjection({ ...(raw as object), id: LINKED_VIEW_ID }) : null) ?? { id: LINKED_VIEW_ID, name: LAYOUT_NAMES.table, layout: 'table' as const };
  cache.set(key, v);
  return v;
}

/** The kanban linked view `lv` shows, when this reader has it on the board (null: deleted, or not visible to them). */
export function linkedSource(lv: Pick<KanbanViewElement, 'sourceId'>, get: (id: string) => BoardElement | undefined): KanbanElement | null {
  const el = typeof lv.sourceId === 'string' && lv.sourceId ? get(lv.sourceId) : undefined;
  return el && el.type === 'kanban' ? el : null;
}

/** A new linked view's saved view: a `layout` named `name` (default the layout's name). */
export function newLinkedView(layout: ProjectionLayout, name?: string | null): ProjectionView {
  const n = typeof name === 'string' && name.trim() ? name.trim().slice(0, VIEW_LIMITS.name) : LAYOUT_NAMES[layout];
  return { id: LINKED_VIEW_ID, name: n, layout } as ProjectionView;
}

/** Why `name` can't name a linked view, or null. */
export function linkedViewNameProblem(name: string): string | null {
  const n = name.trim();
  if (!n) return 'A view needs a name';
  if (n.length > VIEW_LIMITS.name) return `At most ${VIEW_LIMITS.name} characters`;
  return null;
}

/** The stored patch that saves `view` as linked view `lv`'s view (the stored id kept as LINKED_VIEW_ID). */
export function withLinkedViewSaved(view: ProjectionView): Pick<KanbanViewElement, 'view'> {
  return { view: cleanProjection({ ...view, id: LINKED_VIEW_ID })! };
}

/**
 * Where a new linked view of kanban `k` goes: right of it, top edges level, `LINKED_VIEW_GAP`
 * away — or the nearest free spot to that (clear of `obstacles`, the board's other items).
 */
export function linkedViewSpot(k: Rect, size: { w: number; h: number }, obstacles: Rect[]): Point {
  return findFreeSpot(obstacles, size, { x: k.x + k.w + LINKED_VIEW_GAP + size.w / 2, y: k.y + size.h / 2 }, 40);
}

/** A new linked view of kanban `k` at `at` (the server's add_view; the web creates the same element). */
export function linkedViewDraft(id: string, k: Pick<KanbanElement, 'id'>, view: ProjectionView, at: Point): ElementDraft {
  const size = LINKED_VIEW_SIZES[view.layout];
  return { id, type: 'kanbanview', x: at.x, y: at.y, w: size.w, h: size.h, rotation: 0, sourceId: k.id, ...withLinkedViewSaved(view) };
}

/**
 * What a projection shows, in words (the outline, agents): "table", "list by Stage", "calendar by
 * Due date", "timeline from Start date to Due date in lanes by Team". Deleted fields read past, as
 * the views themselves do.
 */
export function projectionWords(k: KanbanElement | null, v: ProjectionView, schema: readonly FieldDef[]): string {
  const date = (ref: string) => dateFields(schema).find((f) => f.id === ref)?.name ?? ref;
  switch (v.layout) {
    case 'table':
      return 'table';
    case 'list': {
      const g = k ? listGroupField(k, v, schema) : null;
      return g ? `list by ${g.name}` : 'list';
    }
    case 'calendar':
      return `calendar by ${date(calendarDateField(v, schema))}`;
    case 'timeline': {
      const t = timelineFields(v, schema);
      return `timeline from ${date(t.start)} to ${date(t.end)}${t.lanes ? ` in lanes by ${t.lanes.name}` : ''}`;
    }
  }
}
