import { memo, useMemo } from 'react';
import type { BoardElement, ConnectorElement } from '@freero/shared';
import {
  defineElement,
  ElementText,
  richTextToPlain,
  useEditor,
  useElement,
  useSettings,
  type ElementRenderProps,
  type NewElement,
} from '@engine';
import {
  capShape,
  capTrim,
  distToPoly,
  labelBox,
  pointAlong,
  routePath,
  type CapShape,
} from './lib/geometry';
import { connectorGeometry, DEFAULT_STYLE, drawnRoutes, localAnchors, refreshCache } from './lib/model';
import './connector.css';

function dashArray(style: ConnectorElement['strokeStyle'], w: number): string | undefined {
  if (style === 'dashed') return `${w * 4} ${w * 3}`;
  if (style === 'dotted') return `0 ${w * 2.4}`;
  return undefined;
}

function Cap({ shape, color, width }: { shape: CapShape | null; color: string; width: number }) {
  if (!shape) return null;
  const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
  switch (shape.kind) {
    case 'polyline':
      return <polyline points={pts(shape.points)} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" />;
    case 'polygon':
      return <polygon points={pts(shape.points)} fill={color} stroke={color} strokeWidth={width * 0.5} strokeLinejoin="round" />;
    case 'circle':
      return <circle cx={shape.c.x} cy={shape.c.y} r={shape.r} fill={color} />;
    case 'line':
      return <line x1={shape.a.x} y1={shape.a.y} x2={shape.b.x} y2={shape.b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  }
}

const ConnectorView = memo(function ConnectorView({ element: c, selected, editing }: ElementRenderProps<ConnectorElement>) {
  const editor = useEditor();
  // Subscribing to the attached elements is what keeps the line glued to them, for local and
  // remote moves alike, whatever the stored cache says.
  const a = useElement(c.start.elementId ?? null);
  const b = useElement(c.end.elementId ?? null);
  const { background } = useSettings();
  const geo = useMemo(() => {
    const lookup = (id: string): BoardElement | undefined => (id === a?.id ? a : id === b?.id ? b : editor.getElement(id));
    return connectorGeometry(c, lookup, localAnchors(editor));
  }, [c, a, b, editor]);
  drawnRoutes.set(c, geo.route.poly);

  const sw = c.strokeWidth;
  const color = c.stroke;
  const { route } = geo;
  const d = routePath(route, capTrim(c.startCap, sw), capTrim(c.endCap, sw), c.routing === 'elbow');
  const hasLabel = !!richTextToPlain(c.label).trim();
  return (
    <>
      <svg className="fr-cx" width="1" height="1" aria-hidden>
        <g transform={`translate(${-c.x} ${-c.y})`}>
          {selected && <path className="fr-cx__halo" d={d} strokeWidth={sw + 8} />}
          <path
            d={d}
            fill="none"
            stroke={color}
            strokeWidth={sw}
            strokeDasharray={dashArray(c.strokeStyle, sw)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <Cap shape={capShape(c.startCap, route.poly[0], route.startTangent, sw)} color={color} width={sw} />
          <Cap shape={capShape(c.endCap, route.poly[route.poly.length - 1], route.endTangent, sw)} color={color} width={sw} />
        </g>
      </svg>
      {(hasLabel || editing) && (
        <div
          className={`fr-cx-label${editing ? ' is-editing' : ''}`}
          style={{ left: geo.mid.x - c.x, top: geo.mid.y - c.y, background }}
        >
          <ElementText
            element={c}
            field="label"
            fontSize={14}
            align="center"
            vAlign="middle"
            padding={0}
            color="#17162B"
            placeholder="Add text"
            style={{ position: 'relative', inset: 'auto', overflow: 'visible' }}
          />
        </div>
      )}
    </>
  );
});

export default defineElement({
  type: 'connector',
  resize: 'none',
  rotatable: false,
  connectable: false,
  textField: 'label',
  defaults: (): Omit<NewElement<'connector'>, 'x' | 'y'> => ({
    type: 'connector',
    w: 1,
    h: 1,
    start: { x: 0, y: 0 },
    end: { x: 0, y: 0 },
    label: '',
    waypoints: [],
    ...DEFAULT_STYLE,
  }),
  Component: ConnectorView,
  toPlainText: (c) => richTextToPlain(c.label),

  // Accurate hit test against the drawn path (not the bounding box), plus the label.
  hitTest(c, local) {
    const p = { x: local.x + c.x, y: local.y + c.y };
    const poly = drawnRoutes.get(c) ?? connectorGeometry(c, () => undefined).route.poly;
    if (distToPoly(p, poly) <= Math.max(7, c.strokeWidth / 2 + 5)) return true;
    const lb = labelBox(richTextToPlain(c.label), pointAlong(poly, 0.5).p);
    return !!lb && p.x >= lb.x && p.x <= lb.x + lb.w && p.y >= lb.y && p.y <= lb.y + lb.h;
  },

  // Engine hook: runs inside every LOCAL change (same undo step / network update). Re-derives
  // the cached endpoints + bounds when an attached element moved, resized, rotated or was
  // deleted (its end then stays where it was, unattached), or when the connector itself changed.
  follow(c, { editor, changed, removed }) {
    const ids = [c.start.elementId, c.end.elementId];
    if (!changed.has(c.id) && !ids.some((id) => id && (changed.has(id) || removed.has(id)))) return null;
    return refreshCache(c, (id) => editor.getElement(id), localAnchors(editor), removed);
  },
});

