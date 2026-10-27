// Board-level mind-map behaviour that no single element owns. Installed once per board by the
// mindmap panel:
//   - keeps the derived tree info (hidden / counts / sides) fresh for the node views;
//   - tracks the local select-tool drag (the `follow` hook carries dragged branches meanwhile)
//     and, on drop, reparents/reorders + re-lays out. Our pointerup listener runs in the capture
//     phase, before the canvas ends the drag gesture, so the drop is part of the drag's undo step.
// (Hidden nodes, Enter/Delete on a selected node and subtree deletes are the element
// definition's: hidden, onKeyDown, removeWith.)
import type { Editor } from '@engine';
import { resetTree, setDragging, setDropTarget, syncTree } from './store';
import { allNodes, dropTargetFor, finishDrag } from './actions';

export function installController(editor: Editor): () => void {
  let armed = false;
  let start = new Map<string, string>();
  const dragged = new Set<string>();

  const refresh = () => {
    const index = syncTree(editor);
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

  refresh();
  const offElements = editor.on('elements', refresh);
  window.addEventListener('pointerdown', onPointerDown, true);
  window.addEventListener('pointerup', onPointerUp, true);
  window.addEventListener('pointercancel', disarm, true);
  return () => {
    offElements();
    window.removeEventListener('pointerdown', onPointerDown, true);
    window.removeEventListener('pointerup', onPointerUp, true);
    window.removeEventListener('pointercancel', disarm, true);
    disarm();
    resetTree();
  };
}
