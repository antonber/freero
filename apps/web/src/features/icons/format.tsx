import { useRef, useState } from 'react';
import type { IconElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { ColorSwatches, Popover, SegmentedControl } from '@ui';
import { DEFAULT_COLOR } from './lib/insert';

const COLORS = [DEFAULT_COLOR, '#6B6880', '#5B3FF0', '#2F80ED', '#14A3A3', '#1FA463', '#F5A524', '#E5484D', '#FF3D8B', '#FFFFFF'];
const NAMES: Record<string, string> = {
  [DEFAULT_COLOR]: 'Ink',
  '#6B6880': 'Slate',
  '#5B3FF0': 'Violet',
  '#2F80ED': 'Blue',
  '#14A3A3': 'Teal',
  '#1FA463': 'Green',
  '#F5A524': 'Amber',
  '#E5484D': 'Red',
  '#FF3D8B': 'Pink',
  '#FFFFFF': 'White',
};
const WEIGHTS = [
  { value: '1.25', label: 'Thin' },
  { value: '2', label: 'Regular' },
  { value: '2.75', label: 'Bold' },
] as const;
type Weight = (typeof WEIGHTS)[number]['value'];

const nearestWeight = (w: number): Weight =>
  WEIGHTS.reduce((best, o) => (Math.abs(Number(o.value) - w) < Math.abs(Number(best.value) - w) ? o : best)).value;

function StyleControl({ editor, icons }: { editor: Editor; icons: IconElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const color = icons[0].color;
  const mixed = icons.some((i) => i.color !== color);
  const set = (patch: Partial<IconElement>) => editor.updateMany(icons.map((i) => ({ id: i.id, patch })));
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-icons-format__btn"
        aria-label="Icon color and weight"
        aria-expanded={open}
        title="Color"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="fr-icons-swatch" style={{ background: mixed ? 'conic-gradient(#E5484D, #F5A524, #1FA463, #2F80ED, #5B3FF0, #E5484D)' : color }} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Icon style">
        <div className="fr-icons-pop">
          <ColorSwatches colors={COLORS} names={NAMES} value={mixed ? null : color} columns={6} size={26} allowCustom onChange={(c) => set({ color: c })} aria-label="Icon color" />
          <span className="fr-icons-pop__label">Line weight</span>
          <SegmentedControl
            size="sm"
            aria-label="Line weight"
            options={WEIGHTS}
            value={nearestWeight(icons[0].strokeWidth)}
            onChange={(v) => set({ strokeWidth: Number(v) })}
          />
        </div>
      </Popover>
    </>
  );
}

export default defineFormat({
  id: 'icons.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'icon'),
  Component: ({ editor, selection }) => <StyleControl editor={editor} icons={selection as IconElement[]} />,
});
