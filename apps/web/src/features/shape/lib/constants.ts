import type { ShapeElement, ShapeKind, StrokeStyle } from '@freero/shared';

import { t } from '../messages';
export const TOOL_ID = 'shape';
export const LIBRARY_PANEL_ID = 'shape.library';
export const DEFAULT_SIZE = 120;
/** Below this drag distance (screen px) a press counts as a click. */
export const CLICK_SLOP_PX = 4;

export const SHAPE_KINDS: Array<{ kind: ShapeKind; label: string }> = [
  { kind: 'rect', label: t('rectangle') },
  { kind: 'roundRect', label: t('roundedRectangle') },
  { kind: 'ellipse', label: t('circle') },
  { kind: 'triangle', label: t('triangle') },
  { kind: 'diamond', label: t('diamond') },
  { kind: 'parallelogram', label: t('parallelogram') },
  { kind: 'trapezoid', label: t('trapezoid') },
  { kind: 'pentagon', label: t('pentagon') },
  { kind: 'hexagon', label: t('hexagon') },
  { kind: 'octagon', label: t('octagon') },
  { kind: 'star', label: t('star') },
  { kind: 'cross', label: t('cross') },
  { kind: 'arrowRight', label: t('arrowRight') },
  { kind: 'arrowLeft', label: t('arrowLeft') },
  { kind: 'chevron', label: t('chevron') },
  { kind: 'speech', label: t('speechBubble') },
  { kind: 'callout', label: t('callout') },
  { kind: 'cloud', label: t('cloud') },
  { kind: 'cylinder', label: t('cylinder') },
  { kind: 'document', label: t('document') },
  { kind: 'predefinedProcess', label: t('process') },
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
