// Format-toolbar controls for text boxes. Mixed selections show the common value, or an
// indeterminate state when the selected boxes disagree.
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
import type { FontFamily, TextAlign, TextElement } from '@freero/shared';
import { useEditingId, useTextFormatState, type Editor } from '@engine';
import { Button, ColorSwatches, IconButton, Input, Menu, Popover } from '@ui';
import { FONT_FAMILIES, FONT_SIZES, HIGHLIGHT_COLORS, TEXT_COLORS } from './constants';

export const MIXED = Symbol('mixed');
export type Maybe<T> = T | typeof MIXED;

export function common<E, T>(items: readonly E[], get: (e: E) => T): Maybe<T> {
  if (!items.length) return MIXED;
  const first = get(items[0]);
  return items.every((e) => get(e) === first) ? first : MIXED;
}

const FONT_STACK: Record<FontFamily, string> = {
  sans: 'var(--fr-font)',
  serif: 'var(--fr-font-serif)',
  mono: 'var(--fr-font-mono)',
  hand: 'var(--fr-font-hand)',
};
const ALIGN_NEXT: Record<TextAlign, TextAlign> = { left: 'center', center: 'right', right: 'left' };
const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

export function patchTexts(editor: Editor, texts: TextElement[], patch: Partial<TextElement>) {
  editor.updateMany(texts.map((t) => ({ id: t.id, patch })));
}

function PopButton(props: { label: string; wide?: boolean; content: ReactNode; width?: number; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className={`fr-textfmt-tb${props.wide ? ' fr-textfmt-tb--wide' : ''}`}
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

function Bar({ color }: { color: Maybe<string> }) {
  const cls = color === MIXED ? ' is-mixed' : color === 'transparent' ? ' is-transparent' : '';
  return <span className={`fr-textfmt-bar${cls}`} style={color !== MIXED && color !== 'transparent' ? { background: color } : undefined} />;
}

export function FontFamilyControl({ editor, texts }: { editor: Editor; texts: TextElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const family = common(texts, (t) => t.fontFamily);
  const label = family === MIXED ? 'Mixed' : FONT_FAMILIES.find((f) => f.value === family)?.label;
  return (
    <>
      <button ref={ref} type="button" className="fr-textfmt-tb fr-textfmt-tb--wide" aria-label="Font" aria-expanded={open} title="Font" onClick={() => setOpen((o) => !o)}>
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
          onSelect: () => patchTexts(editor, texts, { fontFamily: f.value }),
        }))}
      />
    </>
  );
}

/** Parses the custom size field; null when it isn't a usable size. */
export function parseFontSize(input: string): number | null {
  const n = Number(input.trim().replace(/px$/i, ''));
  if (!Number.isFinite(n) || n < 4 || n > 1000) return null;
  return Math.round(n * 10) / 10;
}

export function FontSizeControl({ editor, texts }: { editor: Editor; texts: TextElement[] }) {
  const size = common(texts, (t) => t.fontSize);
  const [custom, setCustom] = useState('');
  const label = size === MIXED ? 'Mixed' : String(Math.round(size * 10) / 10);
  const apply = (v: number) => patchTexts(editor, texts, { fontSize: v });
  return (
    <PopButton label="Text size" wide content={<><span>{label}</span><ChevronDown size={14} aria-hidden /></>} width={180}>
      {(close) => (
        <div className="fr-textfmt-sizes">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const n = parseFontSize(custom);
              if (n !== null) {
                apply(n);
                setCustom('');
                close();
              }
            }}
          >
            <Input
              size="sm"
              inputMode="decimal"
              placeholder={size === MIXED ? 'Custom size' : `${label} (custom)`}
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              aria-label="Custom text size"
              autoFocus
            />
          </form>
          <div className="fr-textfmt-sizes__list" role="listbox" aria-label="Text sizes">
            {FONT_SIZES.map((f) => (
              <button
                key={f}
                type="button"
                role="option"
                aria-selected={f === size}
                className={`fr-textfmt-sizes__item${f === size ? ' is-active' : ''}`}
                onClick={() => {
                  apply(f);
                  close();
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      )}
    </PopButton>
  );
}

export function TextColorControl({ editor, texts }: { editor: Editor; texts: TextElement[] }) {
  const color = common(texts, (t) => t.textColor);
  const editing = !!useEditingId();
  return (
    <PopButton label="Text color" content={<span className="fr-textfmt-a">A<Bar color={color} /></span>} width={240}>
      {() => (
        <ColorSwatches
          colors={TEXT_COLORS}
          value={color === MIXED ? null : color}
          allowCustom
          columns={6}
          size={26}
          onChange={(c) => {
            // While typing: the selected words. Otherwise the whole box (per-word colors cleared).
            if (editing) return editor.formatText('color', c);
            editor.transact(() => {
              editor.formatText('color', 'transparent');
              patchTexts(editor, texts, { textColor: c });
            });
          }}
          aria-label="Text color"
        />
      )}
    </PopButton>
  );
}

export function HighlightControl({ editor, texts }: { editor: Editor; texts: TextElement[] }) {
  const bg = common(texts, (t) => t.background || 'transparent');
  return (
    <PopButton label="Highlight" content={<span className="fr-textfmt-a"><Highlighter size={15} aria-hidden /><Bar color={bg} /></span>} width={240}>
      {() => (
        <ColorSwatches
          colors={HIGHLIGHT_COLORS}
          value={bg === MIXED ? null : bg}
          allowCustom
          columns={6}
          size={26}
          onChange={(c) => patchTexts(editor, texts, { background: c })}
          aria-label="Highlight color"
        />
      )}
    </PopButton>
  );
}

export function AlignButton({ editor, texts }: { editor: Editor; texts: TextElement[] }) {
  const align = common(texts, (t) => t.align);
  const cur: TextAlign = align === MIXED ? 'left' : align;
  return (
    <IconButton
      icon={ALIGN_ICONS[cur]}
      label={`Align: ${cur} (click to change)`}
      size={32}
      onClick={() => patchTexts(editor, texts, { align: align === MIXED ? 'left' : ALIGN_NEXT[cur] })}
    />
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
      <IconButton icon={List} label="Bulleted list" size={32} active={fmt.bullets} onClick={() => editor.formatText('bullets')} />
      <IconButton icon={ListOrdered} label="Numbered list" size={32} active={fmt.numbers} onClick={() => editor.formatText('numbers')} />
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
          className="fr-textfmt-link"
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
