import { useRef, useState } from 'react';
import { STICKY_COLORS, type StickyElement } from '@freero/shared';
import {
  FontFamilyControl,
  FontSizeControl,
  TextAlignControl,
  TextMarkButtons,
  commonValue,
  defineFormat,
  type Editor,
} from '@engine';
import { ColorSwatches, Popover, ToolbarButton } from '@ui';
import { COLOR_HEX, COLOR_NAMES, FONT_SIZES, TOOL_ID, colorFromHex } from './lib/constants';

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
      <ToolbarButton ref={ref} label="Sticky color" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span
          className="fr-sticky-swatch"
          style={{
            background: mixed
              ? `conic-gradient(${stickies.slice(0, 4).map((s, i, a) => `${STICKY_COLORS[s.color]} ${(i / a.length) * 100}% ${((i + 1) / a.length) * 100}%`).join(',')})`
              : STICKY_COLORS[current],
          }}
        />
      </ToolbarButton>
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

export default defineFormat({
  id: 'sticky.format',
  order: 10,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'sticky'),
  Component: ({ editor, selection }) => {
    const stickies = selection as StickyElement[];
    const patch = (p: Partial<StickyElement>) => patchAll(editor, stickies, p);
    return (
      <>
        <ColorControl editor={editor} stickies={stickies} />
        <FontFamilyControl value={commonValue(stickies, (s) => s.fontFamily)} onChange={(fontFamily) => patch({ fontFamily })} />
        <FontSizeControl value={commonValue(stickies, (s) => s.fontSize)} sizes={FONT_SIZES} onChange={(fontSize) => patch({ fontSize })} />
        <TextAlignControl
          align={commonValue(stickies, (s) => s.align)}
          vAlign={commonValue(stickies, (s) => s.vAlign)}
          fallback="center"
          onChange={patch}
        />
        <TextMarkButtons editor={editor} marks={['bold', 'italic', 'strike', 'link']} />
      </>
    );
  },
});
