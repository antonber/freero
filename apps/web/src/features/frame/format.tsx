import { useRef, useState } from 'react';
import { ChevronDown, Maximize2, Shrink } from 'lucide-react';
import type { FrameElement } from '@freero/shared';
import { defineFormat, type Editor } from '@engine';
import { ColorSwatches, IconButton, Menu, Popover, Tooltip } from '@ui';
import { DEFAULT_FILL, PRESETS, presetById } from './lib/frames';
import { fitToContent, setPreset, zoomToFrame } from './lib/actions';

const FILLS = ['#FFFFFF', '#F4F3F8', '#FFF8DB', '#FFEDE3', '#FDEBF4', '#EEEAFF', '#E5F1FF', '#E2F7F1', '#2B2A40', '#17162B'];
const FILL_NAMES: Record<string, string> = {
  '#FFFFFF': 'White',
  '#F4F3F8': 'Mist',
  '#FFF8DB': 'Cream',
  '#FFEDE3': 'Peach',
  '#FDEBF4': 'Blush',
  '#EEEAFF': 'Lavender',
  '#E5F1FF': 'Sky',
  '#E2F7F1': 'Mint',
  '#2B2A40': 'Slate',
  '#17162B': 'Ink',
};

function FillControl({ editor, frames }: { editor: Editor; frames: FrameElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = frames[0].fill || DEFAULT_FILL;
  const mixed = frames.some((f) => (f.fill || DEFAULT_FILL) !== current);
  return (
    <>
      <Tooltip content="Background" side="bottom">
        <button
          ref={ref}
          type="button"
          className="fr-frame-fill-btn"
          aria-label="Frame background"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span style={{ background: mixed ? 'conic-gradient(#fff 0 50%, #e4e3ee 0 100%)' : current }} />
        </button>
      </Tooltip>
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" offset={10} aria-label="Frame background">
        <ColorSwatches
          colors={FILLS}
          names={FILL_NAMES}
          value={mixed ? null : current}
          columns={5}
          size={26}
          allowCustom
          onChange={(fill) => editor.transact(() => frames.forEach((f) => editor.update<FrameElement>(f.id, { fill })))}
          aria-label="Frame background"
        />
      </Popover>
    </>
  );
}

function PresetControl({ editor, frames }: { editor: Editor; frames: FrameElement[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const current = frames[0].preset ?? 'custom';
  const mixed = frames.some((f) => (f.preset ?? 'custom') !== current);
  return (
    <>
      <Tooltip content="Frame size" side="bottom">
        <button
          ref={ref}
          type="button"
          className="fr-frame-fmt-btn"
          aria-label="Frame size"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {mixed ? 'Mixed' : presetById(current).label}
          <ChevronDown size={14} />
        </button>
      </Tooltip>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        side="bottom"
        align="start"
        minWidth={190}
        items={PRESETS.filter((p) => p.id !== 'custom').map((p) => ({
          id: p.id,
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', gap: 16, width: '100%' }}>
              {p.label}
              <span style={{ color: 'var(--fr-ink-3)' }}>{p.hint}</span>
            </span>
          ),
          checked: !mixed && p.id === current,
          onSelect: () => setPreset(editor, frames, p.id),
        }))}
      />
    </>
  );
}

export default defineFormat({
  id: 'frame.format',
  order: 10,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'frame'),
  Component: ({ editor, selection }) => {
    const frames = selection as FrameElement[];
    return (
      <>
        <FillControl editor={editor} frames={frames} />
        <PresetControl editor={editor} frames={frames} />
        <IconButton
          icon={Shrink}
          label="Fit to content"
          size={32}
          onClick={() => {
            editor.beginGesture();
            const fitted = frames.map((f) => fitToContent(editor, f)).some(Boolean);
            editor.endGesture();
            if (!fitted) editor.host.notify('Nothing inside this frame to fit to yet.');
          }}
        />
        {frames.length === 1 && (
          <IconButton icon={Maximize2} label="Zoom to frame" size={32} onClick={() => zoomToFrame(editor, frames[0])} />
        )}
      </>
    );
  },
});
