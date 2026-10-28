// Shared text-style format controls (font, size, color, highlight, marks, alignment). Features
// compose them in their `format.tsx` and own only the write: each control reports the chosen
// value through `onChange`, and the feature patches its elements (and remembers tool defaults).
// One set of controls means a fix or a new option lands for every text-bearing type at once.
import { useRef, useState, type ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ChevronDown,
  Highlighter,
  Italic,
  Link,
  List,
  ListOrdered,
  Strikethrough,
  Underline,
} from 'lucide-react';
import type { FontFamily, TextAlign, VerticalAlign } from '@freero/shared';
import { Button, ColorSwatches, IconButton, Input, Menu, Popover, SegmentedControl, ToolbarButton } from '@ui';
import type { Editor } from '../api';
import { useEditingId, useTextFormatState } from '../hooks';
import { FONT_VARS } from '../text/autofit';
import './textStyle.css';

/** Several selected items disagree on a value. */
export const MIXED: unique symbol = Symbol('mixed');
export type Mixed<T> = T | typeof MIXED;

/** The value every item shares, or MIXED (also for an empty list). */
export function commonValue<E, T>(items: readonly E[], get: (item: E) => T): Mixed<T> {
  if (!items.length) return MIXED;
  const first = get(items[0]);
  return items.every((e) => get(e) === first) ? first : MIXED;
}

export const FONT_FAMILY_OPTIONS: ReadonlyArray<{ value: FontFamily; label: string }> = [
  { value: 'sans', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'mono', label: 'Mono' },
  { value: 'hand', label: 'Handwritten' },
];

export const TEXT_COLOR_PALETTE: readonly string[] = [
  '#17162B', '#4B4A63', '#8A89A3', '#FFFFFF', '#5B3FF0', '#2F80ED',
  '#13A8A8', '#1FA463', '#F5A524', '#F07A2E', '#E5484D', '#D64FA8',
];

export const TEXT_HIGHLIGHT_PALETTE: readonly string[] = [
  'transparent', '#FFF3A3', '#FFC98B', '#FFA9A0', '#F9B9E0', '#D3C4FF',
  '#B5D6FF', '#A7EBEB', '#C2EFB0', '#E6E6EA', '#17162B', '#5B3FF0',
];

/** A font size: px, or 'auto' (shrink to fit the element). */
export type FontSizeValue = number | 'auto';
export type FontSizeOption = FontSizeValue | { value: FontSizeValue; label: string };

/** Parses the custom size field ("18", "18px", "12.5"); null when it isn't a usable size. */
export function parseFontSize(input: string): number | null {
  const s = input.trim().replace(/px$/i, '').trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 4 || n > 1000) return null;
  return Math.round(n * 10) / 10;
}

/** A toolbar button toggling a popover anchored to it. */
function PopButton(props: { label: string; wide?: boolean; face: ReactNode; width?: number; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ToolbarButton ref={ref} label={props.label} wide={props.wide} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {props.face}
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={props.width} aria-label={props.label}>
        {props.children(() => setOpen(false))}
      </Popover>
    </>
  );
}

function ColorBar({ color }: { color: Mixed<string> }) {
  const cls = color === MIXED ? ' is-mixed' : color === 'transparent' ? ' is-transparent' : '';
  return <span className={`fr-textstyle-bar${cls}`} style={color !== MIXED && color !== 'transparent' ? { background: color } : undefined} />;
}

export function FontFamilyControl({ value, onChange }: { value: Mixed<FontFamily>; onChange: (family: FontFamily) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const label = value === MIXED ? 'Mixed' : (FONT_FAMILY_OPTIONS.find((f) => f.value === value)?.label ?? value);
  return (
    <>
      <ToolbarButton ref={ref} label="Font" wide aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span style={{ fontFamily: value === MIXED ? undefined : FONT_VARS[value] }}>{label}</span>
        <ChevronDown size={14} aria-hidden />
      </ToolbarButton>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        minWidth={160}
        aria-label="Font"
        items={FONT_FAMILY_OPTIONS.map((f) => ({
          id: f.value,
          label: <span style={{ fontFamily: FONT_VARS[f.value] }}>{f.label}</span>,
          checked: f.value === value,
          onSelect: () => onChange(f.value),
        }))}
      />
    </>
  );
}

function sizeLabel(v: FontSizeValue): string {
  return v === 'auto' ? 'Auto' : String(Math.round(v * 10) / 10);
}

/**
 * Text size: a custom field plus `sizes` (numbers, 'auto', or labelled presets such as
 * { value: 14, label: 'Small' }). The button shows the preset label when the value is one.
 */
export function FontSizeControl({
  value,
  sizes,
  onChange,
}: {
  value: Mixed<FontSizeValue>;
  sizes: readonly FontSizeOption[];
  onChange: (size: FontSizeValue) => void;
}) {
  const [custom, setCustom] = useState('');
  const options = sizes.map((s) => (typeof s === 'object' ? s : { value: s, label: s === 'auto' ? 'Auto (fit)' : String(s) }));
  const preset = value === MIXED ? undefined : sizes.find((s): s is { value: FontSizeValue; label: string } => typeof s === 'object' && s.value === value);
  const face = value === MIXED ? 'Mixed' : (preset?.label ?? sizeLabel(value));
  return (
    <PopButton label="Text size" wide face={<><span>{face}</span><ChevronDown size={14} aria-hidden /></>} width={190}>
      {(close) => (
        <div className="fr-textstyle-sizes">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseFontSize(custom);
              if (n === null) return;
              onChange(n);
              setCustom('');
              close();
            }}
          >
            <Input
              size="sm"
              inputMode="decimal"
              placeholder={value === MIXED || value === 'auto' ? 'Custom size' : `${sizeLabel(value)} (custom)`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Custom text size"
              autoFocus
            />
          </form>
          <div className="fr-textstyle-sizes__list" role="listbox" aria-label="Text sizes">
            {options.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`fr-textstyle-sizes__item${o.value === value ? ' is-active' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  close();
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </PopButton>
  );
}

/**
 * Text color. While text is being edited it colors the selected words; otherwise `onChange`
 * sets the element color, in one step with clearing per-word colors so it shows everywhere.
 */
export function TextColorControl({
  editor,
  value,
  onChange,
  colors = TEXT_COLOR_PALETTE,
}: {
  editor: Editor;
  value: Mixed<string>;
  onChange: (color: string) => void;
  colors?: readonly string[];
}) {
  const editing = !!useEditingId();
  return (
    <PopButton label="Text color" face={<span className="fr-textstyle-a">A<ColorBar color={value} /></span>} width={240}>
      {() => (
        <ColorSwatches
          colors={[...colors]}
          value={value === MIXED ? null : value}
          allowCustom
          columns={6}
          size={26}
          onChange={(c) => {
            if (editing) return editor.formatText('color', c);
            editor.transact(() => {
              editor.formatText('color', 'transparent');
              onChange(c);
            });
          }}
          aria-label="Text color"
        />
      )}
    </PopButton>
  );
}

/** Background highlight of the whole element ('transparent' = none). */
export function TextHighlightControl({
  value,
  onChange,
  colors = TEXT_HIGHLIGHT_PALETTE,
}: {
  value: Mixed<string>;
  onChange: (color: string) => void;
  colors?: readonly string[];
}) {
  return (
    <PopButton label="Highlight" face={<span className="fr-textstyle-a"><Highlighter size={15} aria-hidden /><ColorBar color={value} /></span>} width={240}>
      {() => (
        <ColorSwatches
          colors={[...colors]}
          value={value === MIXED ? null : value}
          allowCustom
          columns={6}
          size={26}
          onChange={onChange}
          aria-label="Highlight color"
        />
      )}
    </PopButton>
  );
}

export type TextMark = 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'bullets' | 'numbers';
const ALL_MARKS: readonly TextMark[] = ['bold', 'italic', 'underline', 'strike', 'link', 'bullets', 'numbers'];

/**
 * Inline formatting toggles (selected words while editing, else the whole text of the selected
 * elements). `marks` picks which buttons a type offers, in this fixed order.
 */
export function TextMarkButtons({ editor, marks = ALL_MARKS }: { editor: Editor; marks?: readonly TextMark[] }) {
  const fmt = useTextFormatState();
  const has = (m: TextMark) => marks.includes(m);
  return (
    <>
      {has('bold') && <IconButton icon={Bold} label="Bold" shortcut="Mod+B" size={32} active={fmt.bold} onClick={() => editor.formatText('bold')} />}
      {has('italic') && <IconButton icon={Italic} label="Italic" shortcut="Mod+I" size={32} active={fmt.italic} onClick={() => editor.formatText('italic')} />}
      {has('underline') && <IconButton icon={Underline} label="Underline" shortcut="Mod+U" size={32} active={fmt.underline} onClick={() => editor.formatText('underline')} />}
      {has('strike') && <IconButton icon={Strikethrough} label="Strikethrough" size={32} active={fmt.strike} onClick={() => editor.formatText('strike')} />}
      {has('link') && <LinkControl editor={editor} link={fmt.link} />}
      {has('bullets') && <IconButton icon={List} label="Bulleted list" size={32} active={fmt.bullets} onClick={() => editor.formatText('bullets')} />}
      {has('numbers') && <IconButton icon={ListOrdered} label="Numbered list" size={32} active={fmt.numbers} onClick={() => editor.formatText('numbers')} />}
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
          className="fr-textstyle-link"
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

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

/**
 * Horizontal alignment, plus vertical alignment when the type has it (pass `vAlign`). The
 * button shows the current horizontal alignment (`fallback` while mixed).
 */
export function TextAlignControl({
  align,
  vAlign,
  fallback = 'left',
  onChange,
}: {
  align: Mixed<TextAlign>;
  vAlign?: Mixed<VerticalAlign>;
  fallback?: TextAlign;
  onChange: (patch: { align?: TextAlign; vAlign?: VerticalAlign }) => void;
}) {
  const Icon = ALIGN_ICONS[align === MIXED ? fallback : align];
  return (
    <PopButton label="Alignment" face={<Icon size={18} aria-hidden />}>
      {() => (
        <div className="fr-textstyle-pop">
          <SegmentedControl<TextAlign | ''>
            size="sm"
            value={align === MIXED ? '' : align}
            onChange={(v) => v && onChange({ align: v })}
            options={[
              { value: 'left', icon: AlignLeft, title: 'Align left' },
              { value: 'center', icon: AlignCenter, title: 'Align center' },
              { value: 'right', icon: AlignRight, title: 'Align right' },
            ]}
            aria-label="Horizontal alignment"
          />
          {vAlign !== undefined && (
            <SegmentedControl<VerticalAlign | ''>
              size="sm"
              value={vAlign === MIXED ? '' : vAlign}
              onChange={(v) => v && onChange({ vAlign: v })}
              options={[
                { value: 'top', label: 'Top' },
                { value: 'middle', label: 'Middle' },
                { value: 'bottom', label: 'Bottom' },
              ]}
              aria-label="Vertical alignment"
            />
          )}
        </div>
      )}
    </PopButton>
  );
}
