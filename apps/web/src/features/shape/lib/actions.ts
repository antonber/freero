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
  return { ...shapeDefaults(kind), ...(last ?? {}), shape: kind, text: '' };
}

export function shapeInRect(editor: Editor, kind: ShapeKind, r: Rect): NewElement<'shape'> {
  return { ...nextShapeStyle(editor, kind), x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) };
}

/** Switch to the shape tool with `kind` armed (R / O quick keys, flyout picks). */
export function armShape(editor: Editor, kind: ShapeKind) {
  editor.setToolOptions(TOOL_ID, { kind });
  editor.setTool(TOOL_ID);
}
