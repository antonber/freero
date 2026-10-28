// Format-toolbar section for a selection of several item types: the style controls they share
// (fill, border, font, size, text colour, alignment), each applied to every item that has it.
import { useRef, useState, type ReactNode } from 'react';
import { STICKY_COLORS, type BoardElement, type StrokeStyle } from '@freero/shared';
import { ColorSwatches, Popover, SegmentedControl, ToolbarButton } from '@ui';
import type { Editor, SharedStyle } from '../api';
import { applySharedStyle, sharedStyles, sharedValue } from '../editor/sharedStyle';
import {
  FontFamilyControl,
  FontSizeControl,
  MIXED,
  TEXT_COLOR_PALETTE,
  TextAlignControl,
  type FontSizeOption,
  type Mixed,
} from './TextStyleControls';

/** Light fills that read well under text on every type (the sticky papers map exactly). */
const FILL_PALETTE = Object.values(STICKY_COLORS);
const SIZES: readonly FontSizeOption[] = [{ value: 'auto', label: 'Auto (fit)' }, 12, 14, 18, 24, 32, 48, 64];
const WIDTHS = [1, 2, 4, 8] as const;
const STYLES: ReadonlyArray<{ value: StrokeStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

function Swatch({ color, ring }: { color: Mixed<string>; ring?: boolean }) {
  const mixed = color === MIXED;
  return (
    <span
      className={`fr-mixedstyle-swatch${ring ? ' is-ring' : ''}${mixed ? ' is-mixed' : ''}${color === 'transparent' ? ' is-transparent' : ''}`}
      style={!mixed && color !== 'transparent' ? (ring ? { borderColor: color } : { background: color }) : undefined}
    />
  );
}

function Pop({ label, face, width, children }: { label: string; face: ReactNode; width?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <ToolbarButton ref={ref} label={label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {face}
      </ToolbarButton>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} width={width} aria-label={label}>
        {children}
      </Popover>
    </>
  );
}

/** True when the selection holds several types and some style key is shared by two or more items. */
export function hasMixedStyle(editor: Editor, els: BoardElement[]): boolean {
  if (new Set(els.map((el) => el.type)).size < 2) return false;
  const items = sharedStyles(editor, els);
  const keys: Array<keyof SharedStyle> = ['fill', 'stroke', 'strokeWidth', 'strokeStyle', 'fontFamily', 'fontSize', 'textColor', 'align', 'vAlign'];
  return keys.some((k) => sharedValue(items, k) !== null);
}

export function MixedStyleSection({ editor, selection }: { editor: Editor; selection: BoardElement[] }) {
  const items = sharedStyles(editor, selection);
  const v = <K extends keyof SharedStyle>(k: K) => sharedValue(items, k);
  const set = (style: SharedStyle) => applySharedStyle(editor, selection, style);
  const fill = v('fill');
  const stroke = v('stroke');
  const strokeWidth = v('strokeWidth');
  const strokeStyle = v('strokeStyle');
  const fontFamily = v('fontFamily');
  const fontSize = v('fontSize');
  const textColor = v('textColor');
  const align = v('align');
  const vAlign = v('vAlign');
  return (
    <>
      {fill !== null && (
        <Pop label="Fill color" face={<Swatch color={fill} />} width={240}>
          <ColorSwatches
            colors={FILL_PALETTE}
            value={fill === MIXED ? null : fill}
            allowCustom
            columns={6}
            size={26}
            onChange={(c) => set({ fill: c })}
            aria-label="Fill color"
          />
        </Pop>
      )}
      {(stroke !== null || strokeWidth !== null || strokeStyle !== null) && (
        <Pop label="Line and border" face={<Swatch color={stroke ?? MIXED} ring />} width={240}>
          <div className="fr-textstyle-pop">
            {stroke !== null && (
              <ColorSwatches
                colors={[...TEXT_COLOR_PALETTE]}
                value={stroke === MIXED ? null : stroke}
                allowCustom
                columns={6}
                size={26}
                onChange={(c) => set({ stroke: c })}
                aria-label="Line color"
              />
            )}
            {strokeWidth !== null && (
              <SegmentedControl<string>
                size="sm"
                value={strokeWidth === MIXED ? '' : String(strokeWidth)}
                onChange={(w) => w && set({ strokeWidth: Number(w) })}
                options={WIDTHS.map((w) => ({ value: String(w), label: `${w}px` }))}
                aria-label="Line width"
              />
            )}
            {strokeStyle !== null && (
              <SegmentedControl<StrokeStyle | ''>
                size="sm"
                value={strokeStyle === MIXED ? '' : strokeStyle}
                onChange={(s) => s && set({ strokeStyle: s })}
                options={[...STYLES]}
                aria-label="Line style"
              />
            )}
          </div>
        </Pop>
      )}
      {fontFamily !== null && <FontFamilyControl value={fontFamily} onChange={(f) => set({ fontFamily: f })} />}
      {fontSize !== null && <FontSizeControl value={fontSize} sizes={SIZES} onChange={(s) => set({ fontSize: s })} />}
      {textColor !== null && (
        // Not TextColorControl: that clears per-word colours in EVERY selected text, including
        // items that don't take a text colour (a sticky would lose its coloured words).
        <Pop label="Text color" face={<span className="fr-textstyle-a">A<span className={`fr-textstyle-bar${textColor === MIXED ? ' is-mixed' : ''}`} style={textColor !== MIXED ? { background: textColor } : undefined} /></span>} width={240}>
          <ColorSwatches
            colors={[...TEXT_COLOR_PALETTE]}
            value={textColor === MIXED ? null : textColor}
            allowCustom
            columns={6}
            size={26}
            onChange={(c) => set({ textColor: c })}
            aria-label="Text color"
          />
        </Pop>
      )}
      {align !== null && (
        <TextAlignControl align={align} vAlign={vAlign ?? undefined} onChange={(p) => set(p)} />
      )}
    </>
  );
}
