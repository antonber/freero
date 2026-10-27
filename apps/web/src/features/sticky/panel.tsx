// "+" quick-add around a selected sticky: hovering it shows a "+" on each side that adds the next
// sticky there (same color, size and text style) and starts typing in it. Screen space, so the
// buttons keep their size at any zoom. The connector feature's drag-to-connect dots sit further
// out on the same sides (see features/connector), so the two never overlap.
import { useEffect, useState, type CSSProperties } from 'react';
import { Plus } from 'lucide-react';
import { STICKY_COLORS, type StickyElement } from '@freero/shared';
import {
  definePanel,
  useCamera,
  useCanEdit,
  useChromeHidden,
  useEditingId,
  useFormatToolbarRect,
  usePointer,
  useSelectedElements,
  useToolId,
  type Editor,
} from '@engine';
import { createNextSticky } from './lib/actions';
import type { Direction } from './lib/layout';

/** Screen px between the sticky's edge and the center of its "+" (bottom clears the rotate handle). */
const OFFSET = 26;
const OFFSET_BELOW = 58;
/** How far (screen px) outside the sticky the pointer may go and still count as hovering it. */
const HOVER_PAD = 110;

const SIDES: Array<{ dir: Direction; label: string; nx: number; ny: number }> = [
  { dir: 'above', label: 'Add sticky above', nx: 0, ny: -1 },
  { dir: 'right', label: 'Add sticky to the right', nx: 1, ny: 0 },
  { dir: 'below', label: 'Add sticky below', nx: 0, ny: 1 },
  { dir: 'left', label: 'Add sticky to the left', nx: -1, ny: 0 },
];

/** True while any pointer button is held (drags of the sticky itself: hide the buttons). */
function usePointerHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest('.fr-sticky-add'))) setHeld(true);
    };
    const up = () => setHeld(false);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
    };
  }, []);
  return held;
}

function rotate(x: number, y: number, deg: number) {
  if (!deg) return { x, y };
  const r = (deg * Math.PI) / 180;
  return { x: x * Math.cos(r) - y * Math.sin(r), y: x * Math.sin(r) + y * Math.cos(r) };
}

function QuickAdd({ editor, sticky }: { editor: Editor; sticky: StickyElement }) {
  const { zoom } = useCamera();
  // A "+" the format toolbar would cover steps further out along its side (as the connector
  // feature's dots do, which then sit beyond it).
  const bar = useFormatToolbarRect();
  const covered = (q: { x: number; y: number }) =>
    !!bar && q.x > bar.x - 14 && q.x < bar.x + bar.w + 14 && q.y > bar.y - 14 && q.y < bar.y + bar.h + 14;
  const center = editor.worldToScreen({ x: sticky.x + sticky.w / 2, y: sticky.y + sticky.h / 2 });
  const bg = STICKY_COLORS[sticky.color] ?? STICKY_COLORS.yellow;
  return (
    <>
      {SIDES.map(({ dir, label, nx, ny }) => {
        let off = dir === 'below' ? OFFSET_BELOW : OFFSET;
        const at = () => {
          const local = { x: nx * ((sticky.w * zoom) / 2 + off), y: ny * ((sticky.h * zoom) / 2 + off) };
          return rotate(local.x, local.y, sticky.rotation || 0);
        };
        for (let i = 0; i < 40 && covered({ x: center.x + at().x, y: center.y + at().y }); i++) off += 4;
        const p = at();
        const style: CSSProperties = { transform: `translate(${center.x + p.x}px, ${center.y + p.y}px)`, ['--fr-sticky-add' as string]: bg };
        return (
          <button
            key={dir}
            type="button"
            className="fr-sticky-add"
            data-fr-interactive=""
            aria-label={label}
            title={label}
            style={style}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              createNextSticky(editor, sticky, dir);
            }}
          >
            <Plus size={14} strokeWidth={2.6} />
          </button>
        );
      })}
    </>
  );
}

function StickyQuickAdd({ editor }: { editor: Editor }) {
  const selection = useSelectedElements();
  const toolId = useToolId();
  const canEdit = useCanEdit();
  const editingId = useEditingId();
  const hidden = useChromeHidden();
  const pointer = usePointer();
  const held = usePointerHeld();
  const { zoom } = useCamera();
  const single = selection.length === 1 && selection[0].type === 'sticky' ? (selection[0] as StickyElement) : null;
  if (!single || single.locked || !canEdit || hidden || held || editingId || toolId !== 'select' || !pointer) return null;
  // Hovering = the pointer is over the sticky or close around it (to reach the buttons).
  const pad = HOVER_PAD / zoom;
  const c = { x: single.x + single.w / 2, y: single.y + single.h / 2 };
  const local = rotate(pointer.x - c.x, pointer.y - c.y, -(single.rotation || 0));
  if (Math.abs(local.x) > single.w / 2 + pad || Math.abs(local.y) > single.h / 2 + pad) return null;
  return <QuickAdd editor={editor} sticky={single} />;
}

export default definePanel({
  id: 'sticky.quickAdd',
  slot: 'screen-overlay',
  order: 45,
  Component: StickyQuickAdd,
});
