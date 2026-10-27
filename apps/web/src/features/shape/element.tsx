import { memo, useMemo } from 'react';
import type { ShapeElement } from '@freero/shared';
import { defineElement, ElementText, richTextToPlain, type ElementRenderProps, type NewElement } from '@engine';
import { anchorOnOutline, hitShape, insetPaths, textBox } from './lib/geometry';
import { DEFAULT_SIZE, OUTLINE_TOLERANCE } from './lib/constants';
import { shapeDefaults } from './lib/actions';
import './shape.css';

/** Below this zoom text is unreadable: skip laying it out (big boards stay fast). */
const LOD_ZOOM = 0.12;

function dashArray(style: ShapeElement['strokeStyle'], sw: number): string | undefined {
  if (style === 'dashed') return `${Math.max(6, sw * 3)} ${Math.max(4, sw * 2)}`;
  if (style === 'dotted') return `0 ${Math.max(4, sw * 2)}`;
  return undefined;
}

const ShapeView = memo(function ShapeView({ element, zoom }: ElementRenderProps<ShapeElement>) {
  const { shape, w, h, fill, fillOpacity, stroke, strokeStyle } = element;
  const sw = Math.max(0, element.strokeWidth);
  const paths = useMemo(() => insetPaths(shape, w, h, sw), [shape, w, h, sw]);
  const tb = useMemo(() => textBox(shape, w, h), [shape, w, h]);
  // ElementText sizes 'auto' text from the element box: hand it the text area instead.
  const textEl = useMemo(() => ({ ...element, w: tb.w, h: tb.h }), [element, tb]);
  const pad = Math.max(4, Math.min(tb.w, tb.h) * 0.07) + sw / 2;
  const transparent = fill === 'transparent';
  return (
    <div className="fr-shape">
      <svg className="fr-shape__svg" width={w} height={h} aria-hidden>
        <path
          d={paths.outline}
          fill={transparent ? 'none' : fill}
          fillOpacity={fillOpacity}
          stroke={sw > 0 ? stroke : 'none'}
          strokeWidth={sw}
          strokeDasharray={dashArray(strokeStyle, sw)}
          strokeLinejoin="round"
          strokeLinecap={strokeStyle === 'dotted' ? 'round' : 'butt'}
        />
        {paths.details && sw > 0 && (
          <path
            d={paths.details}
            fill="none"
            stroke={stroke}
            strokeWidth={sw}
            strokeDasharray={dashArray(strokeStyle, sw)}
            strokeLinecap={strokeStyle === 'dotted' ? 'round' : 'butt'}
          />
        )}
      </svg>
      {zoom >= LOD_ZOOM && (
        <div className="fr-shape__text" style={{ left: tb.x, top: tb.y, width: tb.w, height: tb.h }}>
          <ElementText element={textEl} field="text" padding={pad} placeholder="" />
        </div>
      )}
    </div>
  );
});

export default defineElement({
  type: 'shape',
  resize: 'free',
  minSize: { w: 8, h: 8 },
  textField: 'text',
  defaults: (): Omit<NewElement<'shape'>, 'x' | 'y'> => ({
    ...shapeDefaults('rect'),
    w: DEFAULT_SIZE,
    h: DEFAULT_SIZE,
  }),
  Component: ShapeView,
  toPlainText: (el) => richTextToPlain(el.text),
  hitTest(el, local) {
    return hitShape(el.shape, el.w, el.h, local, {
      filled: el.fill !== 'transparent' && el.fillOpacity > 0.02,
      tolerance: Math.max(OUTLINE_TOLERANCE, el.strokeWidth / 2 + 3),
      hasText: !!el.text && !!richTextToPlain(el.text).trim(),
    });
  },
  anchorPoint: (el, anchor) => anchorOnOutline(el.shape, el.w, el.h, anchor),
});
