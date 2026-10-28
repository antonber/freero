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

/** Wireframe kit: grey low-fi lines and a readable fixed text size, whatever was used last. */
const WIREFRAME: Partial<ShapeStyle> = { fill: '#FFFFFF', fillOpacity: 1, stroke: '#4B4A63', strokeWidth: 2, strokeStyle: 'solid', fontSize: 14, textColor: '#4B4A63', align: 'left', vAlign: 'middle' };
const HINT = '#8A89A3';
const wire = (text: string, extra: Partial<ShapeStyle> = {}): Partial<ShapeStyle> => ({ ...WIREFRAME, text, ...extra });

/**
 * What a kind needs whatever style was used last: a combined fragment stays see-through (it
 * frames messages), an entity starts as a small table (title, then one attribute per line, keys
 * marked) with its text top-left at a fixed size, wireframe controls start low-fi with a label.
 */
const KIND_STYLE: Partial<Record<ShapeKind, Partial<ShapeStyle>>> = {
  wfBrowser: wire('example.com', { fontSize: 13, textColor: HINT }),
  wfPhone: wire('<b>Screen title</b>', { fontSize: 16 }),
  wfTablet: wire('<b>Screen title</b>', { fontSize: 16 }),
  wfDesktop: wire('<b>Screen title</b>', { fontSize: 16 }),
  wfButton: wire('Button', { fill: '#F2F1F7', align: 'center' }),
  wfInput: wire('Email address', { textColor: HINT }),
  wfSearch: wire('Search', { textColor: HINT }),
  wfTextArea: wire('Write a message…', { textColor: HINT, vAlign: 'top' }),
  wfCheckbox: wire('Remember me'),
  wfRadio: wire('Option'),
  wfToggle: wire('Notifications'),
  wfDropdown: wire('Choose…'),
  wfTabs: wire('Overview', { align: 'center' }),
  wfNavBar: wire('<b>Product</b>', { fontSize: 16 }),
  wfCard: wire('<b>Card title</b>', { vAlign: 'top' }),
  wfList: wire('<b>List title</b>'),
  wfImage: wire('', { fill: '#F2F1F7' }),
  wfAvatar: wire('', { fill: '#F2F1F7', align: 'center' }),
  wfSlider: wire('Volume'),
  wfModal: wire('<b>Dialog title</b>', { fontSize: 16 }),
  wfProgress: wire('', { fill: '#FFFFFF' }),
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
