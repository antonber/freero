// Format-toolbar building blocks for shapes (kind, fill, border). The text-style controls are
// the engine's shared ones (format.tsx). Mixed selections show the common value, or an
// indeterminate state when the selected shapes disagree.
import { useRef, useState, type ReactNode } from 'react';
import { Shapes } from 'lucide-react';
import type { ShapeElement, ShapeKind, StrokeStyle } from '@freero/shared';
import { MIXED, commonValue as common, type Editor, type Mixed as Maybe } from '@engine';
import { ColorSwatches, Popover, SegmentedControl, Slider, ToolbarButton, Tooltip } from '@ui';
import { FILL_COLORS, SHAPE_KINDS, STROKE_COLORS, STROKE_STYLES, STROKE_WIDTHS, TOOL_ID } from './constants';
import { ShapeIcon } from './ShapeIcon';

/** Writes a style patch to every selected shape and remembers it for the next shape drawn. */
export function patchShapes(editor: Editor, shapes: ShapeElement[], patch: Partial<ShapeElement>) {
  editor.updateMany(shapes.map((s) => ({ id: s.id, patch })));
  const { shape: _k, text: _t, ...style } = patch;
  if (Object.keys(style).length) {
    const prev = editor.getToolOptions<{ style?: Partial<ShapeElement> }>(TOOL_ID).style ?? {};
    editor.setToolOptions(TOOL_ID, { style: { ...prev, ...style } });
  }
}

/** A toolbar button that toggles a popover anchored to it. */
function PopButton(props: {
  label: string;
  content: ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ToolbarButton ref={ref} label={props.label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {props.content}
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={props.width} aria-label={props.label}>
        {props.children(() => setOpen(false))}
      </Popover>
    </>
  );
}

function Dot({ color, ring }: { color: Maybe<string>; ring?: boolean }) {
  const mixed = color === MIXED;
  const transparent = color === 'transparent';
  return (
    <span
      className={`fr-shape-dot${ring ? ' fr-shape-dot--ring' : ''}${mixed ? ' is-mixed' : ''}${transparent ? ' is-transparent' : ''}`}
      style={!mixed && !transparent ? (ring ? { borderColor: color } : { background: color }) : undefined}
    />
  );
}

export function KindControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const kind = common(shapes, (s) => s.shape);
  return (
    <PopButton label="Shape" content={kind === MIXED ? <Shapes size={18} aria-hidden /> : <ShapeIcon kind={kind} size={20} />}>
      {(close) => (
        <div className="fr-shape-picker fr-shape-picker--popover" role="radiogroup" aria-label="Shape">
          {SHAPE_KINDS.map((s) => (
            <Tooltip key={s.kind} content={s.label} side="bottom">
              <button
                type="button"
                role="radio"
                aria-checked={s.kind === kind}
                aria-label={s.label}
                className={`fr-shape-picker__item${s.kind === kind ? ' is-active' : ''}`}
                onClick={() => {
                  patchShapes(editor, shapes, { shape: s.kind as ShapeKind });
                  editor.setToolOptions(TOOL_ID, { kind: s.kind });
                  close();
                }}
              >
                <ShapeIcon kind={s.kind} size={22} />
              </button>
            </Tooltip>
          ))}
        </div>
      )}
    </PopButton>
  );
}

export function FillControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const fill = common(shapes, (s) => s.fill);
  const opacity = common(shapes, (s) => s.fillOpacity);
  const sliding = useRef(false);
  return (
    <PopButton label="Fill color" content={<Dot color={fill} />} width={260}>
      {() => (
        <div className="fr-shape-pop">
          <ColorSwatches
            colors={FILL_COLORS}
            value={fill === MIXED ? null : fill}
            onChange={(c) => patchShapes(editor, shapes, { fill: c, ...(c !== 'transparent' && opacity === 0 ? { fillOpacity: 1 } : {}) })}
            columns={6}
            size={26}
            allowCustom
            aria-label="Fill color"
          />
          <Slider
            label="Opacity"
            showValue
            format={(v) => (opacity === MIXED && !sliding.current ? 'Mixed' : `${Math.round(v * 100)}%`)}
            min={0}
            max={1}
            step={0.05}
            value={opacity === MIXED ? 1 : opacity}
            disabled={fill === 'transparent'}
            onChange={(v) => {
              // One undo step for the whole slide.
              if (!sliding.current) {
                sliding.current = true;
                editor.beginGesture();
              }
              patchShapes(editor, shapes, { fillOpacity: v });
            }}
            onCommit={() => {
              if (sliding.current) {
                sliding.current = false;
                editor.endGesture();
              }
            }}
            aria-label="Fill opacity"
          />
        </div>
      )}
    </PopButton>
  );
}

export function BorderControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const stroke = common(shapes, (s) => s.stroke);
  const width = common(shapes, (s) => s.strokeWidth);
  const style = common(shapes, (s) => s.strokeStyle);
  return (
    <PopButton label="Border" content={<Dot color={width === 0 ? 'transparent' : stroke} ring />} width={300}>
      {() => (
        <div className="fr-shape-pop">
          <div className="fr-shape-pop__label">Border color</div>
          <ColorSwatches
            colors={STROKE_COLORS}
            value={stroke === MIXED ? null : stroke}
            onChange={(c) => patchShapes(editor, shapes, { stroke: c, ...(width === 0 ? { strokeWidth: 2 } : {}) })}
            columns={7}
            size={24}
            allowCustom
            aria-label="Border color"
          />
          <div className="fr-shape-pop__label">Thickness</div>
          <SegmentedControl<string>
            size="sm"
            value={width === MIXED ? '' : String(width)}
            onChange={(v) => patchShapes(editor, shapes, { strokeWidth: Number(v) })}
            options={STROKE_WIDTHS.map((w) => ({ value: String(w), label: w === 0 ? 'None' : `${w}`, title: w === 0 ? 'No border' : `${w} px` }))}
            aria-label="Border thickness"
          />
          <div className="fr-shape-pop__label">Style</div>
          <SegmentedControl<StrokeStyle | ''>
            size="sm"
            value={style === MIXED ? '' : style}
            onChange={(v) => v && patchShapes(editor, shapes, { strokeStyle: v, ...(width === 0 ? { strokeWidth: 2 } : {}) })}
            options={STROKE_STYLES.map((s) => ({ value: s, icon: <StrokeSample style={s} />, title: s[0].toUpperCase() + s.slice(1) }))}
            aria-label="Border style"
          />
        </div>
      )}
    </PopButton>
  );
}

function StrokeSample({ style }: { style: StrokeStyle }) {
  return (
    <svg width={36} height={10} aria-hidden>
      <line
        x1={2}
        y1={5}
        x2={34}
        y2={5}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={style === 'dashed' ? '6 4' : style === 'dotted' ? '0 4' : undefined}
      />
    </svg>
  );
}
