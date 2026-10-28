// Icon drawings travel inside board elements, written by anyone: render only a whitelist of SVG
// primitives and geometric attributes, so a crafted element can't smuggle links, scripts,
// event handlers or external references into the board.
import { createElement, type ReactNode } from 'react';
import type { IconNode } from '@freero/shared';

const NUM = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i;
const PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s+eE-]*$/;
const POINTS = /^[0-9.,\s+eE-]*$/;

const ATTRS: Record<string, RegExp> = {
  d: PATH,
  points: POINTS,
  cx: NUM, cy: NUM, r: NUM, rx: NUM, ry: NUM,
  x: NUM, y: NUM, width: NUM, height: NUM,
  x1: NUM, y1: NUM, x2: NUM, y2: NUM,
};
const TAGS = new Set(['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect']);
const MAX_NODES = 64;
const MAX_VALUE = 4000;

/** The drawable part of `nodes` (anything unexpected dropped), as plain data. */
export function cleanNodes(nodes: unknown): IconNode[] {
  if (!Array.isArray(nodes)) return [];
  const out: IconNode[] = [];
  for (const n of nodes.slice(0, MAX_NODES)) {
    if (!Array.isArray(n) || typeof n[0] !== 'string' || !TAGS.has(n[0]) || !n[1] || typeof n[1] !== 'object') continue;
    const attrs: Record<string, string> = {};
    for (const [k, v] of Object.entries(n[1] as Record<string, unknown>)) {
      const s = typeof v === 'number' ? String(v) : v;
      if (typeof s !== 'string' || s.length > MAX_VALUE) continue;
      const rule = ATTRS[k];
      if (rule?.test(s.trim())) attrs[k] = s.trim();
      // A few icons fill a dot: only "none" / "currentColor" are kept.
      else if (k === 'fill' && (s === 'none' || s === 'currentColor')) attrs.fill = s;
    }
    if (Object.keys(attrs).length) out.push([n[0], attrs]);
  }
  return out;
}

/** The icon as an inline SVG on lucide's 24-unit grid, stroked in `color`. */
export function IconSvg({ nodes, color, strokeWidth, className }: { nodes: unknown; color: string; strokeWidth: number; className?: string }): ReactNode {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="100%"
      height="100%"
      fill="none"
      stroke={color}
      color={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {cleanNodes(nodes).map(([tag, attrs], i) => createElement(tag, { key: i, ...attrs }))}
    </svg>
  );
}
