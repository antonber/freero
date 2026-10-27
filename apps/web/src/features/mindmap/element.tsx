import { memo, type CSSProperties, type KeyboardEvent } from 'react';
import type { MindmapElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  useCanEdit,
  useEditor,
  useElement,
  type ElementRenderProps,
  type FollowChange,
  type NewElement,
  type Point,
} from '@engine';
import { readableTextColor } from '@ui';
import { NODE_STYLE, nodeSize } from './lib/measure';
import { HUB_R, ROOT_COLOR } from './lib/constants';
import { getInfo, isDragging, isHidden, useIsDropTarget, useNodeInfo } from './lib/store';
import { addSibling, isNode, isQuiet, toggleCollapse } from './lib/actions';
import { planFollow } from './lib/follow';
import './mindmap.css';

type Side = 'left' | 'right';

/** Smooth edge from the parent's hub to this node, in this node's local coordinates. */
function Edge({ node, parent, depth }: { node: MindmapElement; parent: MindmapElement; depth: number }) {
  const side: Side = node.x + node.w / 2 < parent.x + parent.w / 2 ? 'left' : 'right';
  const py = parent.y + parent.h / 2 - node.y;
  const x0 = (side === 'right' ? parent.x + parent.w + HUB_R : parent.x - HUB_R) - node.x;
  const x1 = side === 'right' ? 0 : node.w;
  const y1 = node.h / 2;
  const dx = (x1 - x0) * 0.55;
  return (
    <svg className="fr-mm__edge" width="1" height="1" aria-hidden>
      <path
        d={`M ${x0} ${py} C ${x0 + dx} ${py}, ${x1 - dx} ${y1}, ${x1} ${y1}`}
        // Presentation attributes, not CSS: export clones (html-to-image) don't carry stylesheets.
        fill="none"
        stroke={node.color}
        strokeWidth={depth <= 1 ? 3 : 2}
        strokeLinecap="round"
      />
    </svg>
  );
}

function Hub({ id, side, w, h, collapsed, count, color, canEdit }: {
  id: string;
  side: Side;
  w: number;
  h: number;
  collapsed: boolean;
  count: number;
  color: string;
  canEdit: boolean;
}) {
  const editor = useEditor();
  const style: CSSProperties = collapsed
    ? { top: h / 2, ...(side === 'right' ? { left: w + 6 } : { right: w + 6 }), ['--mm' as string]: color }
    : { top: h / 2, left: side === 'right' ? w : 0, ['--mm' as string]: color };
  return (
    <button
      type="button"
      data-fr-interactive=""
      className={`fr-mm__hub${collapsed ? ' is-collapsed' : ''}`}
      style={style}
      title={collapsed ? `Expand (${count} hidden)` : 'Collapse branch'}
      aria-label={collapsed ? `Expand ${count} hidden ideas` : 'Collapse branch'}
      disabled={!canEdit}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        toggleCollapse(editor, id);
      }}
    >
      {collapsed ? count : null}
    </button>
  );
}

const MindmapNode = memo(function MindmapNode({ element, selected, editing }: ElementRenderProps<MindmapElement>) {
  const editor = useEditor();
  const info = useNodeInfo(element.id);
  const parent = useElement<MindmapElement>(element.parentId);
  const drop = useIsDropTarget(element.id);
  const canEdit = useCanEdit();
  if (info.hidden) return null;

  const isRoot = !element.parentId;
  const s = isRoot ? NODE_STYLE.root : NODE_STYLE.node;
  const color = element.color || ROOT_COLOR;
  const outer: Side = parent && element.x + element.w / 2 < parent.x + parent.w / 2 ? 'left' : isRoot && element.direction === 'left' ? 'left' : 'right';
  const hasKids = info.childCount > 0;

  // Enter while typing commits and adds the next sibling (Shift+Enter = new line).
  const onKeyDownCapture = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!editing || e.key !== 'Enter' || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    addSibling(editor, element.id);
  };

  return (
    <div className="fr-mm" onKeyDownCapture={onKeyDownCapture}>
      {parent && !isHidden(parent.id) && <Edge node={element} parent={parent} depth={info.depth} />}
      <div
        className={`fr-mm__pill${isRoot ? ' is-root' : ''}${drop ? ' is-drop' : ''}${selected ? ' is-selected' : ''}`}
        style={{ ['--mm' as string]: color, borderRadius: Math.min(element.h / 2, 26) }}
      >
        <ElementText
          element={element}
          field="text"
          fontSize={s.font}
          fontFamily="sans"
          align="center"
          vAlign="middle"
          color={isRoot ? readableTextColor(color) : 'var(--fr-ink)'}
          padding={0}
          style={{ padding: `${s.padY}px ${s.padX}px`, fontWeight: s.weight }}
          placeholder={isRoot ? 'Central topic' : 'Idea'}
        />
      </div>
      {hasKids && element.collapsed && (
        <Hub id={element.id} side={outer} w={element.w} h={element.h} collapsed count={info.descendantCount} color={color} canEdit={canEdit} />
      )}
      {hasKids && !element.collapsed && (info.kidsRight || (!info.kidsLeft && outer === 'right')) && (
        <Hub id={element.id} side="right" w={element.w} h={element.h} collapsed={false} count={0} color={isRoot ? color : element.color} canEdit={canEdit} />
      )}
      {hasKids && !element.collapsed && info.kidsLeft && (
        <Hub id={element.id} side="left" w={element.w} h={element.h} collapsed={false} count={0} color={color} canEdit={canEdit} />
      )}
    </div>
  );
});

/** One plan per local change (the engine hands every node the same change object). */
const plans = new WeakMap<FollowChange, Map<string, Point>>();

function planFor(change: FollowChange): Map<string, Point> {
  let plan = plans.get(change);
  if (plan) return plan;
  const ed = change.editor;
  // Mid-transaction the ordered list is stale: use it for ids only, read values from the store.
  const nodes = ed
    .getElements()
    .filter(isNode)
    .map((n) => ed.getElement(n.id))
    .filter(isNode);
  plan = planFollow({
    nodes,
    changed: change.changed,
    removed: change.removed,
    selected: new Set(ed.getSelection()),
    dragging: isDragging(),
    previousRoot: (id) => getInfo(id).root,
  });
  plans.set(change, plan);
  return plan;
}

export default defineElement({
  type: 'mindmap',
  resize: 'none',
  rotatable: false,
  textField: 'text',
  defaults: (): Omit<NewElement<'mindmap'>, 'x' | 'y'> => {
    const { w, h } = nodeSize('', true);
    return { type: 'mindmap', text: '', parentId: null, rootId: '', color: ROOT_COLOR, direction: 'right', w, h };
  },
  Component: MindmapNode,
  // Nodes under a collapsed branch (or left behind by a plain delete) can't be clicked.
  hitTest: (el) => !isHidden(el.id),
  toPlainText: (el) => richTextToPlain(el.text),
  // Dragged branches travel whole; any other local change to a map re-lays it out — in the
  // same transaction (one undo step), and only on the client that made the change.
  follow(el, change) {
    if (isQuiet()) return null;
    const p = planFor(change).get(el.id);
    return p && (p.x !== el.x || p.y !== el.y) ? { x: p.x, y: p.y } : null;
  },
  normalize(el) {
    const { w, h } = nodeSize(richTextToPlain(el.text), !el.parentId);
    return w !== el.w || h !== el.h ? { w, h } : null;
  },
});
