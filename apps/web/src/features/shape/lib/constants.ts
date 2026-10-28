import type { ShapeElement, ShapeKind, StrokeStyle } from '@freero/shared';

export const TOOL_ID = 'shape';
export const LIBRARY_PANEL_ID = 'shape.library';
export const DEFAULT_SIZE = 120;
/** Below this drag distance (screen px) a press counts as a click. */
export const CLICK_SLOP_PX = 4;

export const SHAPE_KINDS: Array<{ kind: ShapeKind; label: string }> = [
  { kind: 'rect', label: 'Rectangle' },
  { kind: 'roundRect', label: 'Rounded rectangle' },
  { kind: 'ellipse', label: 'Circle' },
  { kind: 'triangle', label: 'Triangle' },
  { kind: 'diamond', label: 'Diamond' },
  { kind: 'parallelogram', label: 'Parallelogram' },
  { kind: 'trapezoid', label: 'Trapezoid' },
  { kind: 'pentagon', label: 'Pentagon' },
  { kind: 'hexagon', label: 'Hexagon' },
  { kind: 'octagon', label: 'Octagon' },
  { kind: 'star', label: 'Star' },
  { kind: 'cross', label: 'Cross' },
  { kind: 'arrowRight', label: 'Arrow right' },
  { kind: 'arrowLeft', label: 'Arrow left' },
  { kind: 'chevron', label: 'Chevron' },
  { kind: 'speech', label: 'Speech bubble' },
  { kind: 'callout', label: 'Callout' },
  { kind: 'cloud', label: 'Cloud' },
  { kind: 'cylinder', label: 'Cylinder' },
  { kind: 'document', label: 'Document' },
  { kind: 'predefinedProcess', label: 'Process' },
];
export const SHAPE_LABEL = Object.fromEntries(SHAPE_KINDS.map((s) => [s.kind, s.label])) as Record<ShapeKind, string>;

export const FILL_COLORS = [
  'transparent', '#FFFFFF', '#F2F1F7', '#CFCDE0', '#4B4A63', '#17162B',
  '#FFF3A3', '#FFC98B', '#FFA9A0', '#F9B9E0', '#D3C4FF', '#B5D6FF',
  '#A7EBEB', '#C2EFB0', '#F5A524', '#E5484D', '#5B3FF0', '#1FA463',
];
export const STROKE_COLORS = [
  '#17162B', '#4B4A63', '#8A89A3', '#CFCDE0', '#FFFFFF',
  '#5B3FF0', '#2F80ED', '#13A8A8', '#1FA463', '#F5A524', '#F07A2E', '#E5484D', '#D64FA8',
];
export const STROKE_WIDTHS = [0, 1, 2, 4, 8, 12];
export const STROKE_STYLES: StrokeStyle[] = ['solid', 'dashed', 'dotted'];

export const FONT_SIZES: Array<ShapeElement['fontSize']> = ['auto', 10, 12, 14, 18, 24, 32, 48, 64, 96];

export interface ShapeToolOptions {
  kind?: ShapeKind;
}
