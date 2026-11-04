// Icon drawings travel inside board elements, written by anyone: render only what @freero/shared's
// `cleanIconNodes` keeps (SVG primitives with geometric and paint attributes), so a crafted
// element can't smuggle links, scripts, event handlers or external references into the board —
// nor into exports, which are drawn from this same component.
import { createElement, type ReactNode } from 'react';
import { cleanIconNodes, cleanViewBox, ICON_DEFAULT_VIEWBOX, type IconNode } from '@freero/shared';

/** The drawable part of `nodes` (anything unexpected dropped), as plain data. */
export const cleanNodes = (nodes: unknown): IconNode[] => cleanIconNodes(nodes);

/** SVG attribute names as React props. */
const REACT_NAME: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-miterlimit': 'strokeMiterlimit',
  'fill-opacity': 'fillOpacity',
  'stroke-opacity': 'strokeOpacity',
  'fill-rule': 'fillRule',
  'clip-rule': 'clipRule',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
};

/**
 * The icon as an inline SVG. Library icons (no `art`) are lucide line art on its 24-unit grid,
 * stroked in `color`; uploaded ones carry their own paint in their `viewBox` ('mono': their one
 * colour is `color`).
 */
export function IconSvg({
  nodes,
  color,
  strokeWidth,
  className,
  viewBox,
  art,
}: {
  nodes: unknown;
  color: string;
  strokeWidth: number;
  className?: string;
  viewBox?: unknown;
  art?: 'mono' | 'color';
}): ReactNode {
  const own = art === 'mono' || art === 'color';
  const children = cleanNodes(nodes).map(([tag, attrs], i) =>
    createElement(tag, { key: i, ...Object.fromEntries(Object.entries(attrs).map(([k, v]) => [REACT_NAME[k] ?? k, v])) }),
  );
  return own ? (
    <svg className={className} viewBox={cleanViewBox(viewBox) ?? ICON_DEFAULT_VIEWBOX} width="100%" height="100%" fill="none" stroke="none" style={{ color }} aria-hidden>
      {children}
    </svg>
  ) : (
    <svg
      className={className}
      viewBox={ICON_DEFAULT_VIEWBOX}
      width="100%"
      height="100%"
      fill="none"
      // currentColor: `color` may be a CSS value (a default ink painted light on a dark canvas).
      stroke="currentColor"
      style={{ color }}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}
