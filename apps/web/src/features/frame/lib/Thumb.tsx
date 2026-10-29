// A tiny live rendition of a frame: its background plus a block per child (Frames panel, deck).
import { memo } from 'react';
import { STICKY_COLORS, type BoardElement, type FrameElement } from '@freero/shared';
import { DEFAULT_FILL } from './frames';

function childColor(el: BoardElement): string {
  switch (el.type) {
    case 'sticky':
      return STICKY_COLORS[el.color] ?? STICKY_COLORS.yellow;
    case 'shape':
      return el.fill !== 'transparent' ? el.fill : el.stroke;
    case 'text':
      return '#8A89A3';
    case 'image':
      return '#C9C7DC';
    default: {
      const c = (el as unknown as Record<string, unknown>).fill ?? (el as unknown as Record<string, unknown>).color;
      return typeof c === 'string' && c !== 'transparent' ? c : '#B9B7CC';
    }
  }
}

/** A tiny live rendition of the frame: its background plus a block per child. */
export const Thumb = memo(function Thumb({ frame, children, w, h }: { frame: FrameElement; children: BoardElement[]; w: number; h: number }) {
  const k = Math.min(w / frame.w, h / frame.h);
  return (
    <svg width={Math.max(4, frame.w * k)} height={Math.max(4, frame.h * k)} viewBox={`${frame.x} ${frame.y} ${frame.w} ${frame.h}`} aria-hidden>
      <rect x={frame.x} y={frame.y} width={frame.w} height={frame.h} fill={frame.fill || DEFAULT_FILL} />
      {children.map((el) =>
        el.type === 'text' ? (
          <rect key={el.id} x={el.x} y={el.y + el.h * 0.3} width={el.w} height={Math.max(el.h * 0.4, 2 / k)} rx={2 / k} fill={childColor(el)} />
        ) : (
          <rect
            key={el.id}
            x={el.x}
            y={el.y}
            width={Math.max(el.w, 2 / k)}
            height={Math.max(el.h, 2 / k)}
            rx={el.type === 'shape' && el.shape === 'ellipse' ? Math.min(el.w, el.h) / 2 : 1 / k}
            fill={childColor(el)}
            transform={el.rotation ? `rotate(${el.rotation} ${el.x + el.w / 2} ${el.y + el.h / 2})` : undefined}
          />
        ),
      )}
    </svg>
  );
});

