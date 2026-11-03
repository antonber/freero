// What people do to a diagram (#117) and its layers (#118). Every write is one undo step through the
// Editor; the live layout itself is the element's `arrange` (@freero/shared planDiagram).
import { nanoid } from 'nanoid';
import {
  DEFAULT_LAYER,
  DIAGRAM_LAYOUT,
  diagramAround,
  diagramLayers,
  memberLayerId,
  plainToRichText,
  type BoardElement,
  type DiagramElement,
  type DiagramLayer,
  type DiagramLayout,
  type ElementType,
} from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';

/** A laidOut value that never matches a signature: the next pass reflows ("Lay out again"). */
const STALE = 'stale';
/** The person's own settings for a diagram (personal view `_layer`: the layer new items join). */
const ACTIVE_LAYER_VIEW = '_layer';

/** Items a diagram takes in (containers with layouts of their own stay out). */
const OUTSIDERS = new Set<ElementType>(['diagram', 'kanban', 'kanbanview', 'swimlane', 'timeline', 'timelinebar', 'mindmap', 'table']);

export function newDiagram(center: Point, title = 'Diagram', layout: DiagramLayout = 'down'): NewElement<'diagram'> {
  const { minW: w, minH: h } = DIAGRAM_LAYOUT;
  return { type: 'diagram', x: Math.round(center.x - w / 2), y: Math.round(center.y - h / 2), w, h, title: plainToRichText(title), layout };
}

/** Insert ▸ Diagram: an empty diagram on a free spot near the middle of the view, selected. */
export function insertDiagram(editor: Editor, near?: Point): string | null {
  const { minW: w, minH: h } = DIAGRAM_LAYOUT;
  const spot = editor.findFreeSpot({ w, h }, near ? { near } : undefined);
  const id = editor.create(newDiagram({ x: spot.x + w / 2, y: spot.y + h / 2 }), { select: true });
  return id || null;
}

export const selectedDiagram = (editor: Editor): DiagramElement | null => {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  return el?.type === 'diagram' ? (el as DiagramElement) : null;
};

/** The diagram the selection is in (all of it, directly or through frames), or the selected diagram. */
export function diagramOfSelection(editor: Editor): DiagramElement | null {
  const own = selectedDiagram(editor);
  if (own) return own;
  const sel = editor.getSelection().map((id) => editor.getElement(id)).filter((e): e is BoardElement => !!e);
  if (!sel.length) return null;
  const look = { get: (id: string) => editor.getElement(id) };
  const first = diagramAround(sel[0], look);
  return first && sel.every((el) => diagramAround(el, look)?.id === first.id) ? first : null;
}

/** Selected items that are members of a diagram (directly). */
export const selectedMembers = (editor: Editor, d: DiagramElement): BoardElement[] =>
  editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el && el.frameId === d.id);

/** What "Make a diagram" would take: selected items a diagram may hold, not already in one. */
export function wrappable(editor: Editor): BoardElement[] {
  const look = { get: (id: string) => editor.getElement(id) };
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el && !OUTSIDERS.has(el.type) && !diagramAround(el, look) && !el.locked);
}

/**
 * Make a diagram of the selected items (and the lines between them): the diagram takes them as they
 * are drawn — manual layout, so nothing moves until a layout is picked. One undo step.
 */
export function wrapSelection(editor: Editor): string | null {
  const items = wrappable(editor);
  if (!items.length) return null;
  const ids = new Set(items.map((el) => el.id));
  // Lines between two of them come along even when they weren't selected.
  for (const el of editor.getElements()) {
    if (el.type !== 'connector' || ids.has(el.id)) continue;
    const a = el.start.elementId;
    const b = el.end.elementId;
    if (a && b && ids.has(a) && ids.has(b)) ids.add(el.id);
  }
  const top = [...ids].map((id) => editor.getElement(id)!).filter((el) => !(el.frameId && ids.has(el.frameId)));
  const box = editor.getBounds(top.filter((el) => el.type !== 'connector').map((el) => el.id)) ?? editor.getBounds(top.map((el) => el.id));
  if (!box) return null;
  const { pad, headerH } = DIAGRAM_LAYOUT;
  let id = '';
  editor.transact(() => {
    const parent = top[0].frameId && top.every((el) => el.frameId === top[0].frameId) ? top[0].frameId : null;
    id = editor.create<'diagram'>({
      type: 'diagram',
      x: Math.round(box.x - pad),
      y: Math.round(box.y - pad - headerH),
      w: Math.round(box.w + 2 * pad),
      h: Math.round(box.h + 2 * pad + headerH),
      title: plainToRichText('Diagram'),
      layout: 'manual',
      frameId: parent,
    });
    if (!id) return;
    // Under its members.
    const lowest = Math.min(...top.map((el) => el.z));
    editor.updateMany([{ id, patch: { z: lowest - 1 } }, ...top.map((el) => ({ id: el.id, patch: { frameId: id } as ElementPatch }))]);
  });
  if (id) editor.select([id]);
  return id || null;
}

export function setLayout(editor: Editor, id: string, layout: DiagramLayout): void {
  const d = editor.getElement<DiagramElement>(id);
  if (!d || d.layout === layout) return;
  editor.update<DiagramElement>(id, { layout });
}

/** Lay out again: every pin cleared and the whole diagram reflowed (one undo step). */
export function relayout(editor: Editor, id: string): void {
  const d = editor.getElement<DiagramElement>(id);
  if (!d) return;
  editor.transact(() => {
    editor.updateMany([
      ...editor.getElements().filter((el) => el.frameId === id && el.diagramPinned).map((el) => ({ id: el.id, patch: { diagramPinned: null } as ElementPatch })),
      { id, patch: { laidOut: STALE } as ElementPatch },
    ]);
  });
}

/** "Let the layout place it": the selected members lose their pins and the diagram reflows. */
export function unpin(editor: Editor, d: DiagramElement, ids: string[]): void {
  const pinned = ids.map((id) => editor.getElement(id)).filter((el): el is BoardElement => !!el && el.frameId === d.id && !!el.diagramPinned);
  if (!pinned.length) return;
  editor.transact(() => {
    editor.updateMany([...pinned.map((el) => ({ id: el.id, patch: { diagramPinned: null } as ElementPatch })), { id: d.id, patch: { laidOut: STALE } as ElementPatch }]);
  });
}

/** Focus mode: zoom to the diagram, everything else faded and out of reach until Esc. */
export function focusDiagram(editor: Editor, id: string): void {
  if (!editor.getElement(id)) return;
  editor.setFocus(id);
  editor.zoomToFit([id], { animate: true, padding: 72, maxZoom: 2 });
}

/** A new step where the diagram was double-clicked: a box that joins it and is laid out. */
export function addStep(editor: Editor, d: DiagramElement, at: Point): string | null {
  const def = editor.getDefinition('shape');
  if (!def || !editor.mayAdd('shape')) return null;
  const base = def.defaults() as Omit<NewElement<'shape'>, 'x' | 'y'>;
  const w = 160;
  const h = 72;
  const id = editor.create({ ...base, type: 'shape', shape: 'roundRect', w, h, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2), frameId: d.id } as NewElement<'shape'>, {
    select: true,
  });
  if (id) editor.startEditing(id);
  return id || null;
}

// ---------------------------------------------------------------------------------- layers

/** The layer this person adds to (personal; the default / bottom one until they pick another). */
export function activeLayer(editor: Editor, d: DiagramElement): string {
  const mine = editor.getPersonalView(d.id, ACTIVE_LAYER_VIEW)?.layer;
  const layers = diagramLayers(d);
  if (typeof mine === 'string' && layers.some((l) => l.id === mine)) return mine;
  return layers.some((l) => l.id === DEFAULT_LAYER) ? DEFAULT_LAYER : layers[0].id;
}

export function setActiveLayer(editor: Editor, d: DiagramElement, layerId: string): void {
  editor.setPersonalView(d.id, ACTIVE_LAYER_VIEW, { layer: layerId });
}

function writeLayers(editor: Editor, d: DiagramElement, layers: DiagramLayer[]): void {
  editor.update<DiagramElement>(d.id, { layers });
}

export function addLayer(editor: Editor, d: DiagramElement): string {
  const layers = diagramLayers(d);
  const names = new Set(layers.map((l) => l.name.toLowerCase()));
  let n = layers.length + 1;
  while (names.has(`layer ${n}`)) n++;
  const layer = { id: nanoid(10), name: `Layer ${n}` };
  writeLayers(editor, d, [...layers, layer]);
  setActiveLayer(editor, d, layer.id);
  return layer.id;
}

export function patchLayer(editor: Editor, d: DiagramElement, layerId: string, patch: Partial<Omit<DiagramLayer, 'id'>>): void {
  const layers = diagramLayers(d).map((l) => (l.id === layerId ? clean({ ...l, ...patch }) : l));
  writeLayers(editor, d, layers);
}

/** A layer without its unset flags (`hidden: null` → absent). */
const clean = (l: DiagramLayer): DiagramLayer => ({ id: l.id, name: l.name, ...(l.hidden ? { hidden: true } : {}), ...(l.locked ? { locked: true } : {}) });

/** One step up (+1, drawn above) or down (−1) the stack. */
export function moveLayer(editor: Editor, d: DiagramElement, layerId: string, dir: 1 | -1): void {
  const layers = [...diagramLayers(d)];
  const i = layers.findIndex((l) => l.id === layerId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j], layers[i]];
  writeLayers(editor, d, layers);
}

/** Deletes a layer; its items move to the layer below it (above, for the bottom one). One undo step. */
export function removeLayer(editor: Editor, d: DiagramElement, layerId: string): void {
  const layers = diagramLayers(d);
  const i = layers.findIndex((l) => l.id === layerId);
  if (i < 0 || layers.length < 2) return;
  const into = layers[i === 0 ? 1 : i - 1];
  const rest = layers.filter((l) => l.id !== layerId);
  editor.transact(() => {
    const moved = editor
      .getElements()
      .filter((el) => el.frameId === d.id && memberLayerId(d, el) === layerId)
      .map((el) => ({ id: el.id, patch: { diagramLayer: into.id } as ElementPatch }));
    editor.updateMany([...moved, { id: d.id, patch: { layers: rest } as ElementPatch }]);
  });
}

/** Moves members of `d` to a layer (one undo step). */
export function moveToLayer(editor: Editor, d: DiagramElement, ids: string[], layerId: string): void {
  if (!diagramLayers(d).some((l) => l.id === layerId)) return;
  const patches = ids
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el && el.frameId === d.id && memberLayerId(d, el) !== layerId)
    .map((el) => ({ id: el.id, patch: { diagramLayer: layerId } as ElementPatch }));
  if (patches.length) editor.updateMany(patches);
}
