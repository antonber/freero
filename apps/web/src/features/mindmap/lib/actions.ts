// Mind-map actions shared by the tool, commands, format toolbar, node views and the controller.
//
// Each action PLANS on an in-memory copy of the nodes (the intended state), computes the layout
// from it, then COMMITS the structural change and the positions in ONE editor.transact: one undo
// step, one network update, written only by the client whose user acted. (Inside a transaction
// editor.getElements() still lists pre-transaction objects, so layouts are never computed
// mid-transaction from it.) While an action commits, the `follow` hook stands down (quiet()).
import { nanoid } from 'nanoid';
import type { BoardElement, MindmapElement } from '@freero/shared';
import type { Editor, ElementPatch, NewElement, Point } from '@engine';
import { layoutTree, LEVEL_GAP, ROOT_GAP, type LayoutOptions } from './layout';
import { nodeSize } from './measure';
import { BRANCH_COLORS, ROOT_COLOR } from './constants';
import { cx, indexNodes, orphanIds, rootOf, sideOf, subtreeIds, type Direction, type Side, type TreeIndex } from './tree';
import { isHidden } from './store';

export const isNode = (el: BoardElement | undefined | null): el is MindmapElement => el?.type === 'mindmap';

/** Current mind-map nodes. Outside a transaction only (see the header). */
export function allNodes(editor: Editor): MindmapElement[] {
  return editor.getElements().filter(isNode);
}

export function currentIndex(editor: Editor): TreeIndex<MindmapElement> {
  return indexNodes(allNodes(editor));
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

/** The single selected, visible mind-map node, if the selection is exactly that. */
export function selectedNode(editor: Editor): MindmapElement | null {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  return isNode(el) && !isHidden(el.id) ? el : null;
}

/**
 * Lays out `rootIds` in the planned state `nodes`, then runs `write` (the structural change) and
 * the resulting position updates in one quiet transaction.
 */
function commit(
  editor: Editor,
  nodes: MindmapElement[],
  rootIds: Iterable<string>,
  write: (positions: Map<string, Point>) => void,
  opts?: LayoutOptions,
) {
  const index = indexNodes(nodes);
  const positions = new Map<string, Point>();
  for (const r of new Set(rootIds)) for (const [id, p] of layoutTree(index, r, opts)) positions.set(id, p);
  quiet(() =>
    editor.transact(() => {
      write(positions);
      const patches: Array<{ id: string; patch: ElementPatch }> = [];
      for (const [id, p] of positions) {
        const cur = editor.getElement(id); // the store read is current inside the transaction
        if (cur && (cur.x !== p.x || cur.y !== p.y)) patches.push({ id, patch: { x: p.x, y: p.y } });
      }
      editor.updateMany(patches);
    }),
  );
}

/** "Tidy up": re-lays out maps and drops nodes orphaned by a plain (non-branch) delete. */
export function relayout(editor: Editor, rootIds: Iterable<string>, opts?: LayoutOptions) {
  const nodes = allNodes(editor);
  const orphans = new Set(orphanIds(indexNodes(nodes)));
  commit(editor, nodes.filter((n) => !orphans.has(n.id)), rootIds, () => {
    if (orphans.size) editor.remove([...orphans]);
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

/** A full planned element for a node that doesn't exist yet. */
function planned(editor: Editor, fields: Omit<MindmapElement, 'id' | 'type' | 'z' | 'rotation' | 'createdBy' | 'createdAt' | 'updatedAt' | 'w' | 'h' | 'text'>): MindmapElement {
  const now = Date.now();
  return {
    ...fields,
    ...nodeSize('', false),
    id: nanoid(),
    type: 'mindmap',
    text: '',
    z: 0,
    rotation: 0,
    createdBy: editor.user.id,
    createdAt: now,
    updatedAt: now,
  };
}

function createAndEdit(editor: Editor, plan: (index: TreeIndex<MindmapElement>) => { node: MindmapElement; rootId: string; expand?: string } | null) {
  editor.stopEditing(); // flush the current text first (its size may change the plan)
  const nodes = allNodes(editor);
  const p = plan(indexNodes(nodes));
  if (!p) return;
  const next = nodes.map((n) => (n.id === p.expand ? { ...n, collapsed: false } : n));
  next.push(p.node);
  commit(editor, next, [p.rootId], (pos) => {
    if (p.expand) editor.update<MindmapElement>(p.expand, { collapsed: false });
    const { z: _z, createdBy: _b, createdAt: _c, updatedAt: _u, ...fields } = p.node;
    editor.create<'mindmap'>({ ...fields, ...(pos.get(p.node.id) ?? {}) });
  });
  if (!editor.getElement(p.node.id)) return;
  editor.select([p.node.id]);
  editor.startEditing(p.node.id);
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
      node: planned(editor, {
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
      node: planned(editor, {
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
 * Delete key on mind-map nodes: removes each selected node with its whole subtree (and any other
 * selected, unlocked element), re-lays out what's left and selects the parent so keyboard flow
 * continues.
 */
export function deleteBranches(editor: Editor, ids: string[]) {
  const nodes = allNodes(editor);
  const index = indexNodes(nodes);
  const remove = new Set<string>();
  const roots = new Set<string>();
  let parentToSelect: string | null = null;
  for (const id of ids) {
    const el = editor.getElement(id);
    if (!el || el.locked) continue;
    if (!isNode(el)) {
      remove.add(id);
      continue;
    }
    for (const d of subtreeIds(index, id)) remove.add(d);
    const root = rootOf(index, id);
    if (root && root.id !== id) roots.add(root.id);
    if (!parentToSelect && el.parentId) parentToSelect = el.parentId;
  }
  if (!remove.size) return;
  commit(
    editor,
    nodes.filter((n) => !remove.has(n.id)),
    [...roots].filter((r) => !remove.has(r)),
    () => editor.remove([...remove]),
  );
  if (parentToSelect && !remove.has(parentToSelect) && editor.getElement(parentToSelect)) editor.select([parentToSelect]);
}

export function toggleCollapse(editor: Editor, id: string, collapsed?: boolean) {
  const nodes = allNodes(editor);
  const index = indexNodes(nodes);
  const node = index.byId.get(id);
  const root = node && rootOf(index, id);
  if (!node || !root || !(index.kids.get(id) ?? []).length) return;
  const next = collapsed ?? !node.collapsed;
  commit(
    editor,
    nodes.map((n) => (n.id === id ? { ...n, collapsed: next } : n)),
    [root.id],
    () => editor.update<MindmapElement>(id, { collapsed: next }),
  );
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
  const roots = new Set(rootIds);
  commit(
    editor,
    allNodes(editor).map((n) => (roots.has(n.id) ? { ...n, direction } : n)),
    rootIds,
    () => editor.updateMany(rootIds.map((id) => ({ id, patch: { direction } as ElementPatch }))),
    { rebalance: direction === 'both' },
  );
}

/**
 * End of a drag of mind-map nodes (still inside the drag's undo gesture): a node dropped onto
 * another node becomes its last child; otherwise its new position decides its sibling order
 * (and, on a 'both' map, its side). Then every touched map is re-laid out.
 */
export function finishDrag(editor: Editor, draggedIds: string[]) {
  const nodes = allNodes(editor);
  const index = indexNodes(nodes);
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
  commit(
    editor,
    nodes.map((n) => (patches.has(n.id) ? { ...n, ...patches.get(n.id) } : n)),
    roots,
    () => editor.updateMany([...patches].map(([id, p]) => ({ id, patch: p as ElementPatch }))),
  );
}

/** The visible node of any map under `n`'s center that isn't `n`'s parent or in its subtree. */
export function dropTargetFor(editor: Editor, index: TreeIndex<MindmapElement>, n: MindmapElement): MindmapElement | null {
  const sub = subtreeIds(index, n.id);
  const hit = editor.hitTest({ x: n.x + n.w / 2, y: n.y + n.h / 2 }, { exclude: sub, types: ['mindmap'] });
  if (!isNode(hit) || hit.id === n.parentId || isHidden(hit.id) || !rootOf(index, hit.id)) return null;
  return hit;
}
