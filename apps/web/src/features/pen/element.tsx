import { memo, useMemo } from 'react';
import type { PenElement } from '@freero/shared';
import { defineElement, type ElementRenderProps, type NewElement } from '@engine';
import { HIGHLIGHTER_OPACITY, PEN_COLORS, PEN_WIDTHS } from './lib/constants';
import { strokeDistance, strokePath, unpack } from './lib/stroke';
import './pen.css';

const PenView = memo(function PenView({ element }: ElementRenderProps<PenElement>) {
  const { points, strokeWidth, highlighter, baseW, baseH, stroke } = element;
  // The outline only depends on the recorded points; resizing just changes the viewBox scale.
  const d = useMemo(() => strokePath(unpack(points), strokeWidth, highlighter), [points, strokeWidth, highlighter]);
  return (
    <svg
      className={`fr-pen${highlighter ? ' fr-pen--highlighter' : ''}`}
      viewBox={`0 0 ${baseW || 1} ${baseH || 1}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <path d={d} fill={stroke} fillOpacity={highlighter ? HIGHLIGHTER_OPACITY : 1} />
    </svg>
  );
});

export default defineElement({
  type: 'pen',
  resize: 'free',
  minSize: { w: 4, h: 4 },
  sharedStyle: (el) => ({ stroke: el.stroke, strokeWidth: el.strokeWidth }),
  connectable: false,
  defaults: (): Omit<NewElement<'pen'>, 'x' | 'y'> => ({
    type: 'pen',
    w: 1,
    h: 1,
    points: [],
    stroke: PEN_COLORS[0],
    strokeWidth: PEN_WIDTHS[1],
    highlighter: false,
    baseW: 1,
    baseH: 1,
  }),
  Component: PenView,
  // Hits within the engine's screen tolerance of the ink; the eraser asks the same distance.
  distanceTo: (el, local) => strokeDistance(el, local),
  // Highlighter ink multiplies with what's beneath (overlaps darken like real markers). It must
  // sit on the positioned wrapper: that is the stacking context the blend composites against.
  wrapperStyle: (el) => (el.highlighter ? { mixBlendMode: 'multiply' } : undefined),
});
