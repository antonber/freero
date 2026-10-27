// Format-toolbar building blocks for shapes (fill, border, text style). Mixed selections show
// the common value, or an indeterminate state when the selected shapes disagree.
import { useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Italic,
  Link,
  Shapes,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { FontFamily, ShapeElement, ShapeKind, StrokeStyle, TextAlign, VerticalAlign } from '@freero/shared';
import { useEditingId, useTextFormatState, type Editor } from '@engine';
import { Button, ColorSwatches, IconButton, Input, Menu, Popover, SegmentedControl, Slider } from '@ui';
import {
  FILL_COLORS,
  FONT_FAMILIES,
  FONT_SIZES,
  SHAPE_KINDS,
  STROKE_COLORS,
  STROKE_STYLES,
  STROKE_WIDTHS,
  TEXT_COLORS,
  TOOL_ID,
} from './constants';
import { ShapeIcon } from './ShapeIcon';

export const MIXED = Symbol('mixed');
export type Maybe<T> = T | typeof MIXED;

/** The value every item shares, or MIXED. */
export function common<E, T>(items: readonly E[], get: (e: E) => T): Maybe<T> {
  if (!items.length) return MIXED;
  const first = get(items[0]);
  return items.every((e) => get(e) === first) ? first : MIXED;
}

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;
const FONT_STACK: Record<FontFamily, string> = {
  sans: 'var(--fr-font)',
  serif: 'var(--fr-font-serif)',
  mono: 'var(--fr-font-mono)',
  hand: 'var(--fr-font-hand)',
};

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
  className?: string;
  content: ReactNode;
  children: (close: () => void) => ReactNode;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-shape-tb ${props.className ?? ''}`}
        aria-label={props.label}
        aria-expanded={open}
        title={props.label}
        onClick={() => setOpen((o) => !o)}
      >
        {props.content}
      </button>
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
            <button
              key={s.kind}
              type="button"
              role="radio"
              aria-checked={s.kind === kind}
              aria-label={s.label}
              title={s.label}
              className={`fr-shape-picker__item${s.kind === kind ? ' is-active' : ''}`}
              onClick={() => {
                patchShapes(editor, shapes, { shape: s.kind as ShapeKind });
                editor.setToolOptions(TOOL_ID, { kind: s.kind });
                close();
              }}
            >
              <ShapeIcon kind={s.kind} size={22} />
            </button>
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

export function FontFamilyControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const family = common(shapes, (s) => s.fontFamily);
  const label = family === MIXED ? 'Mixed' : FONT_FAMILIES.find((f) => f.value === family)?.label;
  return (
    <>
      <button ref={ref} type="button" className="fr-shape-tb fr-shape-tb--text" aria-label="Font" aria-expanded={open} title="Font" onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: family === MIXED ? undefined : FONT_STACK[family] }}>{label}</span>
        <ChevronDown size={14} aria-hidden />
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        minWidth={160}
        aria-label="Font"
        items={FONT_FAMILIES.map((f) => ({
          id: f.value,
          label: <span style={{ fontFamily: FONT_STACK[f.value] }}>{f.label}</span>,
          checked: f.value === family,
          onSelect: () => patchShapes(editor, shapes, { fontFamily: f.value }),
        }))}
      />
    </>
  );
}

export function FontSizeControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const size = common(shapes, (s) => s.fontSize);
  const [custom, setCustom] = useState('');
  const label = size === MIXED ? 'Mixed' : size === 'auto' ? 'Auto' : String(size);
  const apply = (v: ShapeElement['fontSize']) => patchShapes(editor, shapes, { fontSize: v });
  return (
    <PopButton label="Text size" className="fr-shape-tb--text" content={<><span>{label}</span><ChevronDown size={14} aria-hidden /></>} width={190}>
      {(close) => (
        <div className="fr-shape-sizes">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = Math.round(Number(custom));
              if (n >= 4 && n <= 400) {
                apply(n);
                close();
              }
            }}
          >
            <Input size="sm" type="number" min={4} max={400} placeholder="Custom size" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom text size" />
          </form>
          <div className="fr-shape-sizes__list" role="listbox" aria-label="Text sizes">
            {FONT_SIZES.map((f) => (
              <button
                key={String(f)}
                type="button"
                role="option"
                aria-selected={f === size}
                className={`fr-shape-sizes__item${f === size ? ' is-active' : ''}`}
                onClick={() => {
                  apply(f);
                  close();
                }}
              >
                {f === 'auto' ? 'Auto (fit)' : f}
              </button>
            ))}
          </div>
        </div>
      )}
    </PopButton>
  );
}

export function TextColorControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const color = common(shapes, (s) => s.textColor);
  const editing = !!useEditingId();
  return (
    <PopButton
      label="Text color"
      content={
        <span className="fr-shape-a">
          A<Dot color={color} />
        </span>
      }
      width={240}
    >
      {() => (
        <ColorSwatches
          colors={TEXT_COLORS}
          value={color === MIXED ? null : color}
          allowCustom
          columns={6}
          size={26}
          onChange={(c) => {
            // While typing: colors the selected words. Otherwise: the whole text of every shape
            // (clearing per-word colors so the new color shows everywhere).
            if (editing) return editor.formatText('color', c);
            editor.transact(() => {
              editor.formatText('color', 'transparent');
              patchShapes(editor, shapes, { textColor: c });
            });
          }}
          aria-label="Text color"
        />
      )}
    </PopButton>
  );
}

export function TextStyleButtons({ editor }: { editor: Editor }) {
  const fmt = useTextFormatState();
  return (
    <>
      <IconButton icon={Bold} label="Bold" shortcut="Mod+B" size={32} active={fmt.bold} onClick={() => editor.formatText('bold')} />
      <IconButton icon={Italic} label="Italic" shortcut="Mod+I" size={32} active={fmt.italic} onClick={() => editor.formatText('italic')} />
      <IconButton icon={Underline} label="Underline" shortcut="Mod+U" size={32} active={fmt.underline} onClick={() => editor.formatText('underline')} />
      <IconButton icon={Strikethrough} label="Strikethrough" size={32} active={fmt.strike} onClick={() => editor.formatText('strike')} />
      <LinkControl editor={editor} link={fmt.link} />
    </>
  );
}

function LinkControl({ editor, link }: { editor: Editor; link: string | null }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLButtonElement>(null);
  const apply = (href: string | null) => {
    setOpen(false);
    const v = href?.trim();
    editor.formatText('link', v ? (/^[a-z]+:|^\//i.test(v) ? v : `https://${v}`) : undefined);
  };
  return (
    <>
      <IconButton
        ref={ref}
        icon={Link}
        label="Link"
        shortcut="Mod+K"
        size={32}
        active={!!link || open}
        onClick={() => {
          setValue(link ?? '');
          setOpen((o) => !o);
        }}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={320} aria-label="Link">
        <form
          className="fr-shape-link"
          onSubmit={(e) => {
            e.preventDefault();
            apply(value);
          }}
        >
          <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="Paste or type a link" aria-label="Link URL" autoFocus />
          <Button type="submit" variant="primary" size="sm">
            Apply
          </Button>
          {link && (
            <Button size="sm" variant="ghost" onClick={() => apply(null)}>
              Remove
            </Button>
          )}
        </form>
      </Popover>
    </>
  );
}

export function AlignControl({ editor, shapes }: { editor: Editor; shapes: ShapeElement[] }) {
  const align = common(shapes, (s) => s.align);
  const vAlign = common(shapes, (s) => s.vAlign);
  const Icon = ALIGN_ICONS[align === MIXED ? 'center' : align];
  return (
    <PopButton label="Alignment" content={<Icon size={18} aria-hidden />}>
      {() => (
        <div className="fr-shape-pop">
          <SegmentedControl<TextAlign | ''>
            size="sm"
            value={align === MIXED ? '' : align}
            onChange={(v) => v && patchShapes(editor, shapes, { align: v })}
            options={[
              { value: 'left', icon: AlignLeft, title: 'Align left' },
              { value: 'center', icon: AlignCenter, title: 'Align center' },
              { value: 'right', icon: AlignRight, title: 'Align right' },
            ]}
            aria-label="Horizontal alignment"
          />
          <SegmentedControl<VerticalAlign | ''>
            size="sm"
            value={vAlign === MIXED ? '' : vAlign}
            onChange={(v) => v && patchShapes(editor, shapes, { vAlign: v })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]}
            aria-label="Vertical alignment"
          />
        </div>
      )}
    </PopButton>
  );
}
