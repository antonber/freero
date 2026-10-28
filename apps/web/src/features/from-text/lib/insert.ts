// Putting text-built structure on the board, and updating a diagram from edited source. Both are
// ONE transaction (one undo step), written only through the Editor.
import { nanoid } from 'nanoid';
import {
  indexMindNodes,
  layoutMindTree,
  layoutStructure,
  translateDraft,
  type BoardElement,
  type ElementDraft,
  type LaidOut,
  type MindmapElement,
} from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';
import { EDITABLE, toStructure, type TextKind } from './parse';
import { newRecord, planUpdate, type DiagramRecord } from './reconcile';

export const DIAGRAMS = 'diagramSources';
export const DIALOG_ID = 'from-text.dialog';

/** Lays `text` out as `kind` from (0, 0). Throws a LayoutError (a message for the person) on bad input. */
export function layoutText(kind: TextKind, text: string): LaidOut {
  return layoutStructure(toStructure(kind, text), { newId: nanoid });
}

/** The laid-out drafts as full elements (for the preview). */
export const previewElements = (laid: LaidOut): BoardElement[] =>
  laid.elements.map((d) => ({ ...d, z: 0, createdBy: '', createdAt: 0, updatedAt: 0 }) as BoardElement);

/**
 * Inserts `laid` on a free spot near `at` (default: the middle of the view), selected. Diagrams
 * (Mermaid, trees, org charts, mind maps) remember their source so "Edit diagram source" can lay
 * them out again. Returns the new top-level ids.
 */
export function insertLaid(editor: Editor, kind: TextKind, source: string, laid: LaidOut, at?: Point): string[] {
  const spot = editor.findFreeSpot(laid.size, at ? { near: at } : undefined);
  const placed: LaidOut = { ...laid, elements: laid.elements.map((d) => translateDraft(d, spot.x, spot.y)) };
  let ids: string[] = [];
  editor.transact(() => {
    if (Object.keys(placed.content).length) {
      // Content kept outside the elements (table cells) is written by its owner on insert.
      const center = { x: spot.x + laid.size.w / 2, y: spot.y + laid.size.h / 2 };
      ids = editor.insertElements({ elements: previewElements(placed), content: placed.content }, { at: center });
      return;
    }
    ids = editor.createMany(placed.elements as unknown as NewElement[]);
    // The source is shared board content: kept only for a diagram everyone with access sees (not
    // private-mode drafts, not inside a hidden frame), so it never reveals withheld text.
    if (EDITABLE.has(kind) && placed.keys && ids.length && ids.every((id) => editor.layerOf(id) === 'shared'))
      editor.collection<DiagramRecord>(DIAGRAMS).set(nanoid(), newRecord(kind, source, placed));
    tidyMindMaps(editor, placed.elements.filter((d) => d.type === 'mindmap' && !d.parentId).map((d) => d.id));
  });
  const top = ids.filter((id) => {
    const el = editor.getElement(id);
    return el && !(el.frameId && ids.includes(el.frameId));
  });
  if (top.length) {
    editor.select(top);
    // Bring it into view (free space may be off screen), never zooming in past where you are.
    editor.zoomToFit(ids, { animate: true, padding: 96, maxZoom: editor.getCamera().zoom });
  }
  return top;
}

/**
 * Lays mind maps out with the mind map's own tidy tree (the real font measures topics a little
 * differently from the layout's estimate).
 */
function tidyMindMaps(editor: Editor, rootIds: string[]) {
  if (!rootIds.length) return;
  const nodes = editor.getElements().filter((e): e is MindmapElement => e.type === 'mindmap');
  const index = indexMindNodes(nodes);
  const patches: Array<{ id: string; patch: ElementPatch }> = [];
  for (const r of rootIds)
    for (const [id, p] of layoutMindTree(index, r)) {
      const n = index.byId.get(id);
      if (n && (n.x !== p.x || n.y !== p.y)) patches.push({ id, patch: { x: p.x, y: p.y } });
    }
  editor.updateMany(patches);
}

/** The diagram (inserted from text) that element `id` belongs to. */
export function diagramOf(editor: Editor, id: string): { diagramId: string; record: DiagramRecord } | null {
  for (const [diagramId, record] of editor.collection<DiagramRecord>(DIAGRAMS).entries()) {
    if (record && Object.values(record.ids).includes(id)) return { diagramId, record };
  }
  return null;
}

/**
 * The selected diagram, when the selection is (part of) exactly one diagram inserted from text and
 * all of it is shared content (its source would otherwise reveal a hidden frame's or a draft's text).
 */
export function selectedDiagram(editor: Editor): { diagramId: string; record: DiagramRecord } | null {
  let found: { diagramId: string; record: DiagramRecord } | null = null;
  for (const id of editor.getSelection()) {
    const d = diagramOf(editor, id);
    if (!d) continue;
    if (found && found.diagramId !== d.diagramId) return null;
    found = d;
  }
  const withheld = (id: string) => (editor.layerOf(id) ?? 'shared') !== 'shared';
  if (found && Object.values(found.record.ids).some(withheld)) return null;
  return found;
}

/**
 * Re-lays a diagram from edited source onto the elements it already has (see reconcile.ts), as
 * one undo step. Returns what changed.
 */
export function updateDiagram(editor: Editor, diagramId: string, source: string, opts: { keepMoved?: boolean } = {}): { created: number; updated: number; removed: number } {
  const coll = editor.collection<DiagramRecord>(DIAGRAMS);
  const record = coll.get(diagramId);
  if (!record) throw new Error('This diagram can no longer be found');
  // Hidden (or made a draft) since the dialog opened: its new source would be shared text about
  // withheld content (KAI-230), so it is not written.
  if (Object.values(record.ids).some((id) => (editor.layerOf(id) ?? 'shared') !== 'shared'))
    throw new Error('This diagram is in a hidden frame now, so its source can’t be edited');
  const laid = layoutText(record.kind, source);
  const plan = planUpdate({ record, source, laid, current: (id) => editor.getElement(id) ?? undefined, keepMoved: opts.keepMoved });
  editor.transact(() => {
    if (plan.create.length) editor.createMany(plan.create as unknown as NewElement[]);
    if (plan.update.length) editor.updateMany(plan.update as Array<{ id: string; patch: ElementPatch }>);
    // Removed last: a topic that moved to another parent must not be taken along with its old one.
    if (plan.remove.length) editor.remove(plan.remove);
    coll.set(diagramId, plan.record);
    tidyMindMaps(editor, plan.mindRoots.filter((id) => editor.getElement(id)));
  });
  const ids = Object.values(plan.record.ids).filter((id) => editor.getElement(id));
  if (ids.length) editor.select(ids.filter((id) => (editor.getElement(id) as ElementDraft | undefined)?.type !== 'connector'));
  return { created: plan.create.length, updated: plan.update.length, removed: plan.remove.length };
}
