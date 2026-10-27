// Mind-map actions shared by the tool, commands, format toolbar, node views and the controller.
//
// Each action writes its structural change and then lays the touched maps out from the board as
// it now is, all in ONE editor.transact (reads inside a transaction see its writes): one undo
// step, one network update, written only by the client whose user acted. While an action
// commits, the `follow` hook stands down (quiet()).
import { nanoid } from 'nanoid';
import type { BoardElement, MindmapElement } from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';
import { layoutTree, LEVEL_GAP, ROOT_GAP, type LayoutOptions } from './layout';
import { nodeSize } from './measure';
import { BRANCH_COLORS, ROOT_COLOR } from './constants';
import { cx, orphanIds, rootOf, sideOf, subtreeIds, type Direction, type Side, type TreeIndex } from './tree';
import { syncTree } from './store';

export const isNode = (el: BoardElement | undefined | null): el is MindmapElement => el?.type === 'mindmap';

/** Current mind-map nodes. */
export function allNodes(editor: Editor): MindmapElement[] {
  return editor.getElements().filter(isNode);
}

/** Tree of every mind-map node on the board right now (cached until the board changes). */
export function currentIndex(editor: Editor): TreeIndex<MindmapElement> {
  return syncTree(editor);
}

// ---- while an action commits its own layout, the follow hook must not second-guess it.
let quietDepth = 0;
export function quiet<T>(fn: () => T): T {
  quietDepth++;
  try {
    return fn();
  } finally {
    quietDepth--;
  }
}
export const isQuiet = () => quietDepth > 0;

/** The single selected mind-map node, if the selection is exactly that (hidden ones can't be selected). */
export function selectedNode(editor: Editor): MindmapElement | null {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  return isNode(el) ? el : null;
}

/**
 * Runs `write` (the structural change), then lays out `rootIds` from the resulting board — all
 * in one quiet transaction.
 */
function commit(editor: Editor, rootIds: Iterable<string>, write: () => void, opts?: LayoutOptions) {
  const roots = [...new Set(rootIds)];
  quiet(() =>
    editor.transact(() => {
      write();
      const index = currentIndex(editor);
      const patches: Array<{ id: string; patch: ElementPatch }> = [];
      for (const r of roots) {
        for (const [id, p] of layoutTree(index, r, opts)) {
          const cur = index.byId.get(id);
          if (cur && (cur.x !== p.x || cur.y !== p.y)) patches.push({ id, patch: { x: p.x, y: p.y } });
        }
      }
      editor.updateMany(patches);
    }),
  );
}

/**
 * "Tidy up": re-lays out maps and drops orphans (nodes whose parent a collaborator deleted while
 * they were adding them; local deletes take the whole subtree along, see removeWith).
 */
export function relayout(editor: Editor, rootIds: Iterable<string>, opts?: LayoutOptions) {
  const orphans = orphanIds(currentIndex(editor));
  commit(editor, rootIds, () => {
    if (orphans.length) editor.remove(orphans);
  }, opts);
}

export function rootIdsOf(editor: Editor, ids: string[]): string[] {
  const index = currentIndex(editor);
  const out = new Set<string>();
  for (const id of ids) {
    const r = rootOf(index, id);
    if (r) out.add(r.id);
  }
  return [...out];
}

function leastUsedColor(used: string[]): string {
  const counts = new Map(BRANCH_COLORS.map((c) => [c, 0]));
  for (const c of used) if (counts.has(c)) counts.set(c, counts.get(c)! + 1);
  let best = BRANCH_COLORS[0];
  for (const c of BRANCH_COLORS) if (counts.get(c)! < counts.get(best)!) best = c;
  return best;
}

export function newRoot(at: Point): NewElement<'mindmap'> {
  const id = nanoid();
  const { w, h } = nodeSize('', true);
  return {
    id,
    type: 'mindmap',
    text: '',
    parentId: null,
    rootId: id,
    direction: 'right',
    color: ROOT_COLOR,
    x: Math.round(at.x - w / 2),
    y: Math.round(at.y - h / 2),
    w,
    h,
  };
}

/** Which side a new child of `parent` goes to. */
function childSide(index: TreeIndex<MindmapElement>, parent: MindmapElement): Side {
  if (parent.parentId) {
    const gp = index.byId.get(parent.parentId);
    return gp ? sideOf(parent, gp) : 'right';
  }
  const dir: Direction = parent.direction ?? 'right';
  if (dir !== 'both') return dir;
  const kids = index.kids.get(parent.id) ?? [];
  const left = kids.filter((k) => sideOf(k, parent) === 'left').length;
  return left < kids.length - left ? 'left' : 'right';
}

/** A new empty node (its x/y only encode where it goes among its siblings; layout places it). */
function newNode(fields: Pick<MindmapElement, 'parentId' | 'rootId' | 'color' | 'x' | 'y'>): NewElement<'mindmap'> {
  return { ...fields, ...nodeSize('', false), id: nanoid(), type: 'mindmap', text: '' };
}

function createAndEdit(
  editor: Editor,
  plan: (index: TreeIndex<MindmapElement>) => { node: NewElement<'mindmap'>; rootId: string; expand?: string } | null,
) {
  editor.stopEditing(); // flush the current text first (its size may change the plan)
  const p = plan(currentIndex(editor));
  if (!p) return;
  // The new node and the text typed into it are ONE undo step (the edit session nests in it).
  editor.beginGesture();
  try {
    commit(editor, [p.rootId], () => {
      if (p.expand) editor.update<MindmapElement>(p.expand, { collapsed: false });
      editor.create<'mindmap'>(p.node);
    });
    const id = p.node.id!;
    if (!editor.getElement(id)) return;
    editor.select([id]);
    editor.startEditing(id);
  } finally {
    editor.endGesture();
  }
}

/** Tab: a new last child of `parentId` (expanding it if collapsed), then type into it. */
export function addChild(editor: Editor, parentId: string) {
  createAndEdit(editor, (index) => {
    const parent = index.byId.get(parentId);
    const root = parent && rootOf(index, parent.id);
    if (!parent || !root) return null;
    const side = childSide(index, parent);
    const kids = (index.kids.get(parent.id) ?? []).filter((k) => sideOf(k, parent) === side);
    const last = kids[kids.length - 1];
    const size = nodeSize('', false);
    const gap = parent.parentId ? LEVEL_GAP : ROOT_GAP;
    return {
      rootId: root.id,
      expand: parent.collapsed ? parent.id : undefined,
      node: newNode({
        parentId: parent.id,
        rootId: root.id,
        color: parent.parentId ? parent.color : leastUsedColor((index.kids.get(parent.id) ?? []).map((k) => k.color)),
        x: side === 'right' ? parent.x + parent.w + gap : parent.x - gap - size.w,
        // Below the current last child: sibling order follows position.
        y: last ? last.y + last.h + 1 : parent.y + parent.h / 2 - size.h / 2,
      }),
    };
  });
}

/** Enter: a sibling right below `nodeId` (a root gets a child instead). */
export function addSibling(editor: Editor, nodeId: string) {
  const node = editor.getElement(nodeId);
  if (!isNode(node)) return;
  if (!node.parentId) return addChild(editor, node.id);
  createAndEdit(editor, (index) => {
    const n = index.byId.get(nodeId);
    const parent = n?.parentId ? index.byId.get(n.parentId) : undefined;
    const root = n && rootOf(index, n.id);
    if (!n || !parent || !root) return null;
    const size = nodeSize('', false);
    return {
      rootId: root.id,
      node: newNode({
        parentId: parent.id,
        rootId: root.id,
        color: n.color,
        x: sideOf(n, parent) === 'right' ? n.x : n.x + n.w - size.w,
        // Center just below this node's center → ordered right after it.
        y: n.y + n.h / 2 + 0.5 - size.h / 2,
      }),
    };
  });
}

/**
 * Delete key on mind-map nodes: removes the selected, unlocked elements (a node takes its whole
 * subtree along: removeWith), re-lays out what's left and selects the parent so keyboard flow
 * continues.
 */
export function deleteBranches(editor: Editor, ids: string[]) {
  const index = currentIndex(editor);
  const remove = ids.filter((id) => {
    const el = editor.getElement(id);
    return !!el && !el.locked;
  });
  if (!remove.length) return;
  const roots = new Set<string>();
  let parentToSelect: string | null = null;
  for (const id of remove) {
    const el = index.byId.get(id);
    if (!el) continue;
    const root = rootOf(index, id);
    if (root && root.id !== id) roots.add(root.id);
    if (!parentToSelect && el.parentId) parentToSelect = el.parentId;
  }
  commit(editor, roots, () => editor.remove(remove));
  if (parentToSelect && editor.getElement(parentToSelect)) editor.select([parentToSelect]);
}

export function toggleCollapse(editor: Editor, id: string, collapsed?: boolean) {
  const index = currentIndex(editor);
  const node = index.byId.get(id);
  const root = node && rootOf(index, id);
  if (!node || !root || !(index.kids.get(id) ?? []).length) return;
  const next = collapsed ?? !node.collapsed;
  commit(editor, [root.id], () => editor.update<MindmapElement>(id, { collapsed: next }));
}

/** Branch color: a root changes only its own fill; any other node recolors its whole branch. */
export function setBranchColor(editor: Editor, ids: string[], color: string) {
  const index = currentIndex(editor);
  const patches = new Map<string, ElementPatch>();
  for (const id of ids) {
    const n = index.byId.get(id);
    if (!n) continue;
    const patch = { color } as ElementPatch;
    if (!n.parentId) patches.set(id, patch);
    else for (const d of subtreeIds(index, id)) patches.set(d, patch);
  }
  editor.updateMany([...patches].map(([id, patch]) => ({ id, patch })));
}

export function setDirection(editor: Editor, rootIds: string[], direction: Direction) {
  commit(editor, rootIds, () => editor.updateMany(rootIds.map((id) => ({ id, patch: { direction } as ElementPatch }))), {
    rebalance: direction === 'both',
  });
}

/**
 * End of a drag of mind-map nodes (still inside the drag's undo gesture): a node dropped onto
 * another node becomes its last child; otherwise its new position decides its sibling order
 * (and, on a 'both' map, its side). Then every touched map is re-laid out.
 */
export function finishDrag(editor: Editor, draggedIds: string[]) {
  const index = currentIndex(editor);
  const dragged = new Set(draggedIds);
  const roots = new Set<string>();
  const patches = new Map<string, Partial<MindmapElement>>();
  const patch = (id: string, p: Partial<MindmapElement>) => patches.set(id, { ...patches.get(id), ...p });
  for (const id of draggedIds) {
    const n = index.byId.get(id);
    if (!n || !n.parentId) continue; // roots just move (their branch followed them)
    let anc = index.byId.get(n.parentId);
    let nested = false;
    const seen = new Set<string>();
    while (anc && !seen.has(anc.id)) {
      if (dragged.has(anc.id)) nested = true;
      seen.add(anc.id);
      anc = anc.parentId ? index.byId.get(anc.parentId) : undefined;
    }
    const oldRoot = rootOf(index, id);
    if (nested || !oldRoot) continue;
    roots.add(oldRoot.id);
    const target = dropTargetFor(editor, index, n);
    if (!target) continue;
    const newRoot = rootOf(index, target.id)!;
    roots.add(newRoot.id);
    const color = target.parentId
      ? target.color
      : newRoot.id === oldRoot.id
        ? n.color
        : leastUsedColor((index.kids.get(target.id) ?? []).map((k) => k.color));
    // Dropped on a 'both' root: the half it was dropped on decides the side.
    const side: Side =
      !target.parentId && target.direction === 'both' ? (cx(n) < cx(target) ? 'left' : 'right') : childSide(index, target);
    const siblings = (index.kids.get(target.id) ?? []).filter((k) => k.id !== id && sideOf(k, target) === side);
    const last = siblings[siblings.length - 1];
    patch(id, {
      parentId: target.id,
      // Appended as the last child on that side (order and side follow position).
      y: last ? last.y + last.h + 1 : target.y + target.h / 2 - n.h / 2,
      x: side === 'right' ? cx(target) + 1 : cx(target) - n.w - 1,
    });
    for (const d of subtreeIds(index, id)) patch(d, { rootId: newRoot.id, color });
  }
  commit(editor, roots, () => editor.updateMany([...patches].map(([id, p]) => ({ id, patch: p as ElementPatch }))));
}

/** The visible node of any map under `n`'s center that isn't `n`'s parent or in its subtree. */
export function dropTargetFor(editor: Editor, index: TreeIndex<MindmapElement>, n: MindmapElement): MindmapElement | null {
  const sub = subtreeIds(index, n.id);
  // Hit tests never return hidden (collapsed / orphaned) nodes.
  const hit = editor.hitTest({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, { exclude: sub, types: ['mindmap'] });
  if (!isNode(hit) || hit.id === n.parentId || !rootOf(index, hit.id)) return null;
  return hit;
}
