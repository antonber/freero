import { useRef, useState } from 'react';
import type { PenElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { ColorSwatches, Popover } from '@ui';
import {
  HIGHLIGHTER_COLOR_NAMES,
  HIGHLIGHTER_COLORS,
  HIGHLIGHTER_WIDTHS,
  PEN_COLOR_NAMES,
  PEN_COLORS,
  PEN_WIDTHS,
  SIZE_LABELS,
  sizeIndexOf,
  type SizeIndex,
} from './lib/constants';
import { rebakeWidth } from './lib/stroke';

function ColorControl({ editor, strokes }: { editor: Editor; strokes: PenElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const allHighlighter = strokes.every((s) => s.highlighter);
  const current = strokes[0].stroke;
  const mixed = strokes.some((s) => s.stroke !== current);
  const colors = allHighlighter ? HIGHLIGHTER_COLORS : PEN_COLORS;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-pen-format-swatch"
        aria-label="Stroke color"
        aria-expanded={open}
        title="Color"
        onClick={() => setOpen((o) => !o)}
      >
        <span style={{ background: mixed ? 'conic-gradient(#E5484D, #F5A524, #1FA463, #2F80ED, #5B3FF0, #E5484D)' : current }} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Stroke color">
        <ColorSwatches
          colors={colors}
          names={allHighlighter ? HIGHLIGHTER_COLOR_NAMES : PEN_COLOR_NAMES}
          value={mixed ? null : current}
          columns={4}
          size={26}
          onChange={(c) => {
            const patch: Partial<PenElement> = { stroke: c };
            editor.updateMany(strokes.map((s) => ({ id: s.id, patch })));
          }}
          aria-label="Stroke color"
        />
      </Popover>
    </>
  );
}

function WidthControl({ editor, strokes }: { editor: Editor; strokes: PenElement[] }) {
  const current = sizeIndexOf(strokes[0].strokeWidth, strokes[0].highlighter);
  const mixed = strokes.some((s) => sizeIndexOf(s.strokeWidth, s.highlighter) !== current);
  const apply = (i: SizeIndex) =>
    editor.updateMany(
      strokes.map((s) => ({ id: s.id, patch: rebakeWidth(s, (s.highlighter ? HIGHLIGHTER_WIDTHS : PEN_WIDTHS)[i]) })),
    );
  return (
    <div className="fr-pen-format-sizes" role="group" aria-label="Stroke width">
      {SIZE_LABELS.map((label, i) => (
        <button
          key={label}
          type="button"
          className="fr-pen-size"
          aria-pressed={!mixed && current === i}
          aria-label={label}
          title={label}
          onClick={() => apply(i as SizeIndex)}
        >
          <span style={{ width: 3 + i * 3, height: 3 + i * 3 }} />
        </button>
      ))}
    </div>
  );
}

export default defineFormat({
  id: 'pen.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'pen'),
  Component: ({ editor, selection }) => {
    const strokes = selection as PenElement[];
    return (
      <>
        <ColorControl editor={editor} strokes={strokes} />
        <WidthControl editor={editor} strokes={strokes} />
      </>
    );
  },
});
