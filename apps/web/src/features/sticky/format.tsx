import { useRef, useState } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Italic,
  Link,
  Strikethrough,
} from 'lucide-react';
import { STICKY_COLORS, type StickyElement, type TextAlign, type VerticalAlign } from '@freero/shared';
import { defineFormat, useTextFormatState, type Editor } from '@engine';
import { Button, ColorSwatches, IconButton, Input, Menu, Popover, SegmentedControl } from '@ui';
import { COLOR_HEX, COLOR_NAMES, FONT_SIZES, TOOL_ID, colorFromHex } from './lib/constants';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

function patchAll(editor: Editor, stickies: StickyElement[], patch: Partial<StickyElement>) {
  editor.updateMany(stickies.map((s) => ({ id: s.id, patch })));
}

function ColorControl({ editor, stickies }: { editor: Editor; stickies: StickyElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = stickies[0].color;
  const mixed = stickies.some((s) => s.color !== current);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-sticky-swatch-btn"
        aria-label="Sticky color"
        aria-expanded={open}
        title="Color"
        onClick={() => setOpen((o) => !o)}
      >
        <span
          style={{
            background: mixed
              ? `conic-gradient(${stickies.slice(0, 4).map((s, i, a) => `${STICKY_COLORS[s.color]} ${(i / a.length) * 100}% ${((i + 1) / a.length) * 100}%`).join(',')})`
              : STICKY_COLORS[current],
          }}
        />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Sticky color">
        <ColorSwatches
          colors={COLOR_HEX}
          names={COLOR_NAMES}
          value={mixed ? null : STICKY_COLORS[current]}
          columns={6}
          size={26}
          onChange={(hex) => {
            const color = colorFromHex(hex);
            patchAll(editor, stickies, { color });
            // The next sticky you place uses the color you picked last.
            editor.setToolOptions(TOOL_ID, { color });
          }}
          aria-label="Sticky color"
        />
      </Popover>
    </>
  );
}

function SizeControl({ editor, stickies }: { editor: Editor; stickies: StickyElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = stickies[0].fontSize;
  const active = FONT_SIZES.find((f) => f.value === current);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-sticky-size-btn"
        aria-label="Text size"
        aria-expanded={open}
        title="Text size"
        onClick={() => setOpen((o) => !o)}
      >
        {active ? active.label : `${current}px`}
      </button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        side="bottom"
        align="center"
        minWidth={150}
        items={FONT_SIZES.map((f) => ({
          id: f.id,
          label: f.label,
          checked: f.value === current,
          onSelect: () => patchAll(editor, stickies, { fontSize: f.value }),
        }))}
      />
    </>
  );
}

function AlignControl({ editor, stickies }: { editor: Editor; stickies: StickyElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { align, vAlign } = stickies[0];
  return (
    <>
      <IconButton ref={ref} icon={ALIGN_ICONS[align]} label="Alignment" size={32} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Alignment">
        <div className="fr-sticky-align">
          <SegmentedControl<TextAlign>
            size="sm"
            value={align}
            onChange={(v) => patchAll(editor, stickies, { align: v })}
            options={[
              { value: 'left', icon: AlignLeft, title: 'Align left' },
              { value: 'center', icon: AlignCenter, title: 'Align center' },
              { value: 'right', icon: AlignRight, title: 'Align right' },
            ]}
            aria-label="Horizontal alignment"
          />
          <SegmentedControl<VerticalAlign>
            size="sm"
            value={vAlign}
            onChange={(v) => patchAll(editor, stickies, { vAlign: v })}
            options={[
              { value: 'top', label: 'Top' },
              { value: 'middle', label: 'Middle' },
              { value: 'bottom', label: 'Bottom' },
            ]}
            aria-label="Vertical alignment"
          />
        </div>
      </Popover>
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
        size={32}
        active={!!link || open}
        onClick={() => {
          setValue(link ?? '');
          setOpen((o) => !o);
        }}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={320} aria-label="Link">
        <form
          className="fr-sticky-link"
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

export default defineFormat({
  id: 'sticky.format',
  order: 10,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'sticky'),
  Component: ({ editor, selection }) => {
    const stickies = selection as StickyElement[];
    const fmt = useTextFormatState();
    return (
      <>
        <ColorControl editor={editor} stickies={stickies} />
        <SizeControl editor={editor} stickies={stickies} />
        <AlignControl editor={editor} stickies={stickies} />
        <IconButton icon={Bold} label="Bold" shortcut="Mod+B" size={32} active={fmt.bold} onClick={() => editor.formatText('bold')} />
        <IconButton icon={Italic} label="Italic" shortcut="Mod+I" size={32} active={fmt.italic} onClick={() => editor.formatText('italic')} />
        <IconButton icon={Strikethrough} label="Strikethrough" size={32} active={fmt.strike} onClick={() => editor.formatText('strike')} />
        <LinkControl editor={editor} link={fmt.link} />
      </>
    );
  },
});
