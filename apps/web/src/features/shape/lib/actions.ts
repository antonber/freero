// Shape creation helpers shared by the tool, commands and defaults.
import type { ShapeElement, ShapeKind } from '@freero/shared';
import type { Editor, NewElement, Rect } from '@engine';
import { TOOL_ID, type ShapeToolOptions } from './constants';

type ShapeStyle = Omit<NewElement<'shape'>, 'x' | 'y' | 'w' | 'h'>;

export function shapeDefaults(kind: ShapeKind): ShapeStyle {
  return {
    type: 'shape',
    shape: kind,
    fill: '#FFFFFF',
    fillOpacity: 1,
    stroke: '#17162B',
    strokeWidth: 2,
    strokeStyle: 'solid',
    text: '',
    fontFamily: 'sans',
    fontSize: 'auto',
    textColor: '#17162B',
    align: 'center',
    vAlign: 'middle',
  };
}

/**
 * What a kind needs whatever style was used last: a combined fragment stays see-through (it
 * frames messages), an entity starts as a small table (title, then one attribute per line, keys
 * marked) with its text top-left at a fixed size.
 */
const KIND_STYLE: Partial<Record<ShapeKind, Partial<ShapeStyle>>> = {
  umlFragment: { fill: 'transparent', fillOpacity: 0, fontSize: 14, align: 'left' },
  umlActivation: { fill: '#F2F1F7' },
  erdEntity: {
    text: '<b>Entity</b><br>PK&nbsp; id<br>FK&nbsp; owner_id<br>name',
    fontSize: 14,
    align: 'left',
    vAlign: 'top',
  },
};

/** The shape kind the tool will draw next (last one picked). */
export function currentKind(editor: Editor): ShapeKind {
  return editor.getToolOptions<ShapeToolOptions>(TOOL_ID).kind ?? 'rect';
}

/**
 * Style for the next shape: the last shape you styled (fill, border, text style) carries over,
 * like picking up the pen you just used. Falls back to defaults.
 */
export function nextShapeStyle(editor: Editor, kind: ShapeKind): ShapeStyle {
  const last = editor.getToolOptions<ShapeToolOptions & { style?: Partial<ShapeElement> }>(TOOL_ID).style;
  return { ...shapeDefaults(kind), ...(last ?? {}), text: '', ...KIND_STYLE[kind], shape: kind };
}

export function shapeInRect(editor: Editor, kind: ShapeKind, r: Rect): NewElement<'shape'> {
  return { ...nextShapeStyle(editor, kind), x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
}

/** Switch to the shape tool with `kind` armed (R / O quick keys, flyout picks). */
export function armShape(editor: Editor, kind: ShapeKind) {
  editor.setToolOptions(TOOL_ID, { kind });
  editor.setTool(TOOL_ID);
}
