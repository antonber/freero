import { useRef, useState, type ReactNode } from 'react';
import { ArrowLeftRight, Bold, CornerDownRight, Italic, Slash, Spline, Workflow } from 'lucide-react';
import type { CapStyle, ConnectorElement, ConnectorRouting, StrokeStyle } from '@freero/shared';
import { defineFormat, richTextToPlain, useTextFormatState, type Editor, type ElementPatch } from '@engine';
import { ColorSwatches, IconButton, Menu, Popover, SegmentedControl, Tooltip, type MenuItem } from '@ui';
import { capShape } from './lib/geometry';
import { patchConnector, TOOL_ID, type ConnectorStyle } from './lib/model';
import { CAP_GROUPS, PRESET_GROUPS } from './lib/presets';

const COLORS = ['#2B2A44', '#8A89A3', '#5B3FF0', '#2F7CF6', '#12A594', '#2FA84F', '#F2A007', '#F06A2B', '#E5484D', '#D6409F', '#FFFFFF'];
const WIDTHS = [1, 2, 3, 4, 6, 8, 12];

/** The line-end menu: plain ends, hollow ends, then crow's-foot cardinalities. */
function capItems(current: CapStyle, flip: boolean, pick: (cap: CapStyle) => void): MenuItem[] {
  return CAP_GROUPS.flatMap((g): MenuItem[] => [
    ...(g.heading ? [{ heading: g.heading }] : []),
    ...g.caps.map((cap) => ({
      id: cap.value,
      label: cap.label,
      icon: <CapIcon cap={cap.value} flip={flip} />,
      checked: current === cap.value,
      onSelect: () => pick(cap.value),
    })),
  ]);
}

/** Writes a style change to every selected connector and remembers it for the next one drawn. */
function apply(editor: Editor, conns: ConnectorElement[], patch: ElementPatch<ConnectorElement> & Partial<ConnectorStyle>) {
  editor.transact(() => {
    for (const c of conns) patchConnector(editor, c.id, patch);
  });
  const remembered: Partial<ConnectorStyle> = {};
  for (const k of ['routing', 'stroke', 'strokeWidth', 'strokeStyle', 'startCap', 'endCap'] as const)
    if (k in patch) (remembered as Record<string, unknown>)[k] = patch[k];
  if (Object.keys(remembered).length) editor.setToolOptions(TOOL_ID, remembered);
}

/** Little preview of a line end, pointing right. */
function CapIcon({ cap, flip }: { cap: CapStyle; flip?: boolean }) {
  const sw = 1.6;
  const tip = { x: 20, y: 10 };
  const pts = (p: { x: number; y: number }[]) => p.map((q) => `${q.x},${q.y}`).join(' ');
  // Hollow marks are knocked out with the menu's own background.
  const paper = 'var(--fr-surface, #fff)';
  const marks: ReactNode[] = capShape(cap, tip, { x: 1, y: 0 }, sw).map((shape, i) => {
    switch (shape.kind) {
      case 'polyline':
        return <polyline key={i} points={pts(shape.points)} fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />;
      case 'polygon':
        return <polygon key={i} points={pts(shape.points)} fill={shape.fill === 'ink' ? 'currentColor' : paper} stroke="currentColor" strokeWidth={shape.fill === 'ink' ? 0 : sw} strokeLinejoin="round" />;
      case 'circle':
        return <circle key={i} cx={shape.c.x} cy={shape.c.y} r={shape.r} fill={shape.fill === 'ink' ? 'currentColor' : paper} stroke={shape.fill === 'ink' ? 'none' : 'currentColor'} strokeWidth={sw} />;
      case 'line':
        return <line key={i} x1={shape.a.x} y1={shape.a.y} x2={shape.b.x} y2={shape.b.y} stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />;
    }
  });
  return (
    <svg width="24" height="20" viewBox="0 0 24 20" aria-hidden style={flip ? { transform: 'scaleX(-1)' } : undefined}>
      <line x1="1" y1="10" x2={tip.x} y2="10" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" />
      {marks}
    </svg>
  );
}

/** Diagram line presets (UML calls, BPMN message flows, ER cardinalities): one pick sets the whole style. */
function PresetButton({ editor, conns }: { editor: Editor; conns: ConnectorElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const items: MenuItem[] = PRESET_GROUPS.flatMap((g): MenuItem[] => [
    { heading: g.heading },
    ...g.presets.map((p) => ({
      id: p.id,
      label: p.label,
      icon: <CapIcon cap={p.style.endCap ?? 'none'} />,
      onSelect: () => apply(editor, conns, { ...p.style, ...(p.style.routing ? { waypoints: [] } : {}) }),
    })),
  ]);
  return (
    <>
      <Tooltip content="Diagram line types" side="bottom">
        <button ref={ref} type="button" className="fr-cx-fmt-btn" aria-label="Diagram line types" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <Workflow size={16} aria-hidden />
        </button>
      </Tooltip>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="center" minWidth={210} items={items} aria-label="Diagram line types" />
    </>
  );
}

function StyleIcon({ style }: { style: StrokeStyle }) {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <line
        x1="2"
        y1="9"
        x2="16"
        y2="9"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={style === 'dashed' ? '4 3' : style === 'dotted' ? '0 3.5' : undefined}
      />
    </svg>
  );
}

function ColorControl({ editor, conns }: { editor: Editor; conns: ConnectorElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const color = conns[0].stroke;
  return (
    <>
      <Tooltip content="Line color" side="bottom">
        <button ref={ref} type="button" className="fr-cx-fmt-swatch" aria-label="Line color" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span style={{ background: color }} />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Line color">
        <ColorSwatches colors={COLORS} value={color} columns={6} size={24} allowCustom onChange={(stroke) => apply(editor, conns, { stroke })} aria-label="Line color" />
      </Popover>
    </>
  );
}

function MenuButton(props: { label: string; children: ReactNode; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Tooltip content={props.label} side="bottom">
        <button ref={ref} type="button" className="fr-cx-fmt-btn" aria-label={props.label} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {props.children}
        </button>
      </Tooltip>
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="center" minWidth={150} items={props.items} aria-label={props.label} />
    </>
  );
}

export default defineFormat({
  id: 'connector.format',
  order: 10,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'connector'),
  Component: ({ editor, selection }) => {
    const conns = selection as ConnectorElement[];
    const c = conns[0];
    const fmt = useTextFormatState();
    const hasLabel = conns.some((x) => richTextToPlain(x.label).trim()) || editor.getEditingId() === c.id;
    return (
      <>
        <SegmentedControl<ConnectorRouting>
          size="sm"
          value={c.routing}
          onChange={(routing) => apply(editor, conns, { routing, waypoints: [] })}
          options={[
            { value: 'straight', icon: Slash, title: 'Straight' },
            { value: 'elbow', icon: CornerDownRight, title: 'Elbow' },
            { value: 'curved', icon: Spline, title: 'Curved' },
          ]}
          aria-label="Line type"
        />
        <ColorControl editor={editor} conns={conns} />
        <MenuButton
          label="Line width"
          items={WIDTHS.map((w) => ({
            id: `w${w}`,
            label: `${w} px`,
            checked: c.strokeWidth === w,
            onSelect: () => apply(editor, conns, { strokeWidth: w }),
          }))}
        >
          {c.strokeWidth} px
        </MenuButton>
        <MenuButton
          label="Line style"
          items={(['solid', 'dashed', 'dotted'] as const).map((s) => ({
            id: s,
            label: s[0].toUpperCase() + s.slice(1),
            icon: <StyleIcon style={s} />,
            checked: c.strokeStyle === s,
            onSelect: () => apply(editor, conns, { strokeStyle: s }),
          }))}
        >
          <StyleIcon style={c.strokeStyle} />
        </MenuButton>
        <MenuButton
          label="Start of line"
          items={capItems(c.startCap, true, (startCap) => apply(editor, conns, { startCap }))}
        >
          <CapIcon cap={c.startCap} flip />
        </MenuButton>
        <IconButton
          icon={ArrowLeftRight}
          label="Swap line ends"
          size={32}
          onClick={() =>
            editor.transact(() => {
              for (const x of conns) patchConnector(editor, x.id, { startCap: x.endCap, endCap: x.startCap });
            })
          }
        />
        <MenuButton
          label="End of line"
          items={capItems(c.endCap, false, (endCap) => apply(editor, conns, { endCap }))}
        >
          <CapIcon cap={c.endCap} />
        </MenuButton>
        <PresetButton editor={editor} conns={conns} />
        {hasLabel && (
          <>
            <IconButton icon={Bold} label="Bold" shortcut="Mod+B" size={32} active={fmt.bold} onClick={() => editor.formatText('bold')} />
            <IconButton icon={Italic} label="Italic" shortcut="Mod+I" size={32} active={fmt.italic} onClick={() => editor.formatText('italic')} />
          </>
        )}
      </>
    );
  },
});
