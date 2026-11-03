// Shape (square / rectangle) and size (S / M / L) of stickies: the format toolbar's control for the
// selection and the tool's options for the next sticky share these two switches.
import { RectangleHorizontal, Square } from 'lucide-react';
import { SegmentedControl } from '@ui';
import type { StickyShape, StickySize } from './constants';

const SHAPES = [
  { value: 'square' as const, icon: Square, title: 'Square' },
  { value: 'rect' as const, icon: RectangleHorizontal, title: 'Rectangle' },
];
const SIZES = [
  { value: 's' as const, label: 'S', title: 'Small' },
  { value: 'm' as const, label: 'M', title: 'Medium' },
  { value: 'l' as const, label: 'L', title: 'Large' },
];

/** `null`: the items disagree (or one was resized freely): no segment is on. */
export function BoxControl(props: {
  shape: StickyShape | null;
  size: StickySize | null;
  onShape: (shape: StickyShape) => void;
  onSize: (size: StickySize) => void;
}) {
  return (
    <div className="fr-sticky-box">
      <SegmentedControl size="sm" aria-label="Sticky shape" options={SHAPES} value={(props.shape ?? '') as StickyShape} onChange={props.onShape} />
      <SegmentedControl size="sm" aria-label="Sticky size" options={SIZES} value={(props.size ?? '') as StickySize} onChange={props.onSize} />
    </div>
  );
}

/** The icon of a shape (the format toolbar's button face). */
export const shapeIcon = (shape: StickyShape | null) => (shape === 'rect' ? RectangleHorizontal : Square);
