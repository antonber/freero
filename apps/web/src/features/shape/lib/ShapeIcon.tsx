import type { ShapeKind } from '@freero/shared';
import { insetPaths } from './geometry';

const WIDE = new Set<ShapeKind>([
  'arrowRight', 'arrowLeft', 'parallelogram', 'chevron', 'hexagon', 'terminator', 'manualInput', 'manualOperation',
  'display', 'delay', 'storedData', 'loopLimit', 'punchedTape', 'netSwitch', 'netLaptop',
]);
const TALL = new Set<ShapeKind>(['umlActor', 'netPhone', 'collate']);

/** Small line icon of a shape kind drawn from the same geometry as the element (Freero's own). */
export function ShapeIcon({ kind, size = 20, strokeWidth = 1.6 }: { kind: ShapeKind; size?: number | string; strokeWidth?: number | string }) {
  const s = Number(size) || 20;
  const sw = Number(strokeWidth) || 1.6;
  const pad = s * 0.12;
  const box = s - pad * 2;
  // Wide shapes read better in a slightly wider box.
  const wide = WIDE.has(kind);
  const tall = TALL.has(kind);
  const w = tall ? box * 0.6 : box;
  const h = wide ? box * 0.66 : box;
  const p = insetPaths(kind, w, h, sw);
  return (
    <svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} fill="none" aria-hidden>
      <g transform={`translate(${pad + (box - w) / 2} ${pad + (box - h) / 2})`} stroke="currentColor" strokeWidth={sw} strokeLinejoin="miter" strokeLinecap="round">
        <path d={p.outline} />
        {p.details && <path d={p.details} />}
      </g>
    </svg>
  );
}

export const shapeIconFor = (kind: ShapeKind) =>
  function KindIcon(props: { size?: number | string; strokeWidth?: number | string }) {
    return <ShapeIcon kind={kind} {...props} />;
  };
