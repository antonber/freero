// Board-level mind-map behaviour that no single element owns. Installed once per board by the
// mindmap panel:
//   - keeps the derived tree info (hidden / counts / sides) fresh and drops hidden nodes from
//     the selection (local UI state only);
//   - tracks the local select-tool drag (the `follow` hook carries dragged branches meanwhile)
//     and, on drop, reparents/reorders + re-lays out. Our pointerup listener runs in the capture
//     phase, before the canvas ends the drag gesture, so the drop is part of the drag's undo step;
//   - keys the engine routes elsewhere: Enter on a selected node adds a sibling (the engine's
//     own Enter = edit text is registered first), Delete/Backspace removes whole branches.
import type { MindmapElement } from '@freero/shared';
import type { Editor } from '@engine';
import { computeInfo, indexNodes } from './tree';
import { isHidden, setDragging, setDropTarget, setInfos } from './store';
import { addSibling, allNodes, deleteBranches, dropTargetFor, finishDrag, isNode, selectedNode } from './actions';

function isTextInput(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable) return true;
  if (t.closest('[role="dialog"], [data-fr-keyboard-trap]')) return true;
  const tag = t.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') return !['button', 'checkbox', 'radio', 'range', 'color', 'submit'].includes((t as HTMLInputElement).type);
  return false;
}

export function installController(editor: Editor): () => void {
  let prev: MindmapElement[] = [];
  let armed = false;
  let start = new Map<string, string>();
  const dragged = new Set<string>();

  const dropHiddenFromSelection = () => {
    const sel = editor.getSelection();
    if (sel.some(isHidden)) editor.select(sel.filter((id) => !isHidden(id)));
  };

  const refresh = () => {
    const nodes = allNodes(editor);
    if (nodes.length === prev.length && nodes.every((n, i) => n === prev[i])) return;
    prev = nodes;
    const index = indexNodes(nodes);
    setInfos(computeInfo(index));
    dropHiddenFromSelection();
    if (!armed) return;
    // Which selected nodes has this drag moved? (Drop hint when it's a single branch.)
    for (const id of editor.getSelection()) {
      const n = index.byId.get(id);
      if (n && start.has(id) && start.get(id) !== `${n.x},${n.y}`) dragged.add(id);
    }
    const only = dragged.size === 1 ? index.byId.get([...dragged][0]) : undefined;
    setDropTarget(only?.parentId ? (dropTargetFor(editor, index, only)?.id ?? null) : null);
  };

  const onPointerDown = (e: PointerEvent) => {
    const t = e.target as Element | null;
    if (e.button !== 0 || editor.getToolId() !== 'select') return;
    if (!t?.closest?.('.fr-viewport') || t.closest('[data-fr-interactive], [data-fr-text-editor]')) return;
    armed = true;
    setDragging(true);
    dragged.clear();
    start = new Map(allNodes(editor).map((n) => [n.id, `${n.x},${n.y}`]));
  };

  const disarm = () => {
    armed = false;
    setDragging(false);
    setDropTarget(null);
    const ids = [...dragged];
    dragged.clear();
    return ids;
  };

  const onPointerUp = () => {
    if (!armed) return;
    const ids = disarm();
    if (ids.length && editor.can('editor')) finishDrag(editor, ids);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.isComposing || isTextInput(e.target)) return;
    if (editor.getEditingId() || !editor.can('editor')) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      const n = selectedNode(editor);
      if (!n || n.locked) return;
      e.preventDefault();
      addSibling(editor, n.id);
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      const sel = editor.getSelection();
      if (!sel.some((id) => isNode(editor.getElement(id)))) return;
      e.preventDefault();
      deleteBranches(editor, sel);
    }
  };

  refresh();
  const offElements = editor.on('elements', refresh);
  const offSelection = editor.on('selection', dropHiddenFromSelection);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', disarm, true);
  window.addEventListener('keydown', onKeyDown, true);
  return () => {
    offElements();
    offSelection();
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', disarm, true);
    window.removeEventListener('keydown', onKeyDown, true);
    disarm();
    setInfos(new Map());
  };
}
