// Sticky pad (#132): a stack of blank stickies of one colour. Dragging from the top sheet peels a
// new sticky off under the pointer (one undo step: create + drag); the pad stays. The glue strip
// at the top is ordinary element surface, so the pad itself is selected and moved from there.
import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import { StickyNote } from 'lucide-react';
import { STICKY_COLORS, STICKY_INK, stickyInk, type StickyPadElement } from '@freero/shared';
import { defineElement, useCanEdit, useEditor, useIsExporting, useParticipant, type Editor, type ElementRenderProps, type LowDetailPaint, type NewElement, type Point } from '@engine';
import { DEFAULT_COLOR, STICKY_SIZE, nearestColor } from './constants';
import { stickyAt } from './actions';

/** How far the sheets under the top one show (world units). */
export const PAD_STACK = 8;
/** Height of the glue strip (fraction of the pad's height). */
const GLUE = 0.16;
/** A press that moves less than this (screen px) is a click: the sticky lands beside the pad. */
const CLICK_SLOP = 4;
const BESIDE_GAP = 24;

/** The sticky a pad gives: the size of its top sheet, its colour. */
export function peeledSticky(editor: Editor, pad: StickyPadElement, center: Point): NewElement<'sticky'> {
  const w = Math.max(48, pad.w - PAD_STACK);
  const h = Math.max(48, pad.h - PAD_STACK);
  return stickyAt(editor, center, { color: pad.color, w, h });
}

/**
 * Peels a sticky off `pad` and drags it with the pointer until release: create and moves are one
 * gesture, so one undo step takes the sticky back. A plain click puts it beside the pad. Ends by
 * selecting the new sticky and starting to type in it.
 */
function peel(editor: Editor, pad: StickyPadElement, down: ReactPointerEvent<HTMLElement>) {
  down.preventDefault();
  down.stopPropagation();
  if (!editor.mayAdd('sticky')) {
    editor.host.notify(editor.isParticipant() ? 'You can add stickies while private mode is on.' : 'You can’t add stickies on this board.', 'info');
    return;
  }
  // The viewport's offset in the page: the pad's top-left is at its box (client) and at
  // worldToScreen (viewport) at once. Pads don't rotate, so the box's corner is that point.
  const box = (down.currentTarget.closest('.fr-stickypad') ?? down.currentTarget).getBoundingClientRect();
  const corner = editor.worldToScreen({ x: pad.x, y: pad.y });
  const origin = { x: box.left - corner.x, y: box.top - corner.y };
  const world = (e: { clientX: number; clientY: number }) => editor.screenToWorld({ x: e.clientX - origin.x, y: e.clientY - origin.y });

  const drag = startPeel(editor, pad, world(down));
  if (!drag) return;
  let moved = false;
  const onMove = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    if (!moved && Math.hypot(e.clientX - down.clientX, e.clientY - down.clientY) < CLICK_SLOP) return;
    moved = true;
    drag.move(world(e));
  };
  const finish = (e: PointerEvent) => {
    if (e.pointerId !== down.pointerId) return;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', finish);
    const id = drag.end(moved);
    editor.select([id]);
    editor.startEditing(id);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', finish);
  window.addEventListener('pointercancel', finish);
}

/**
 * The peel itself, pointer-free: a new sticky lifted off the top sheet that follows `move` (world
 * points, keeping where it was grabbed) until `end`, all in one gesture — one undo step. `end(false)`
 * (a click, no drag) puts it beside the pad. Null when this person may not add a sticky now.
 */
export function startPeel(editor: Editor, pad: StickyPadElement, grabbedAt: Point): { move(p: Point): void; end(moved: boolean): string } | null {
  editor.beginGesture();
  const draft = peeledSticky(editor, pad, { x: pad.x + (pad.w - PAD_STACK) / 2, y: pad.y + (pad.h - PAD_STACK) / 2 });
  const id = editor.create(draft, { select: false });
  if (!id) {
    editor.endGesture();
    return null;
  }
  const grab = { x: grabbedAt.x - draft.x, y: grabbedAt.y - draft.y };
  return {
    move: (p) => editor.update(id, { x: Math.round(p.x - grab.x), y: Math.round(p.y - grab.y) }),
    end(moved) {
      if (!moved) editor.update(id, { x: Math.round(pad.x + pad.w + BESIDE_GAP), y: Math.round(pad.y) });
      editor.endGesture();
      return id;
    },
  };
}

const PadView = memo(function PadView({ element }: ElementRenderProps<StickyPadElement>) {
  const editor = useEditor();
  const exporting = useIsExporting();
  const canEdit = useCanEdit();
  const participant = useParticipant();
  const bg = STICKY_COLORS[element.color] ?? STICKY_COLORS[DEFAULT_COLOR];
  const ink = stickyInk(element.color);
  const canPeel = !exporting && (canEdit || participant);
  return (
    <div className="fr-stickypad" style={{ ['--paper' as string]: bg, color: ink }}>
      <span className="fr-stickypad__sheet is-under-2" aria-hidden />
      <span className="fr-stickypad__sheet is-under-1" aria-hidden />
      <div className={`fr-stickypad__top${ink === STICKY_INK ? '' : ' is-dark'}`} style={{ inset: `0 ${PAD_STACK}px ${PAD_STACK}px 0` }}>
        <span className="fr-stickypad__glue" style={{ height: `${GLUE * 100}%` }} />
        <div
          className="fr-stickypad__peel"
          style={{ top: `${GLUE * 100}%` }}
          {...(canPeel ? { 'data-fr-interactive': '', onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => e.button === 0 && peel(editor, element, e) } : {})}
          title={canPeel ? 'Drag to peel off a sticky' : undefined}
        >
          {!exporting ? (
            <span className="fr-stickypad__hint">
              <StickyNote size={16} aria-hidden /> Drag to peel
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
});

/**
 * Zoomed out to low detail (#131): the pad as a sticky — the sheets under it a shade darker, the
 * top sheet in its paper with the glue strip. No shadows, no peel hint.
 */
function paintPad(el: StickyPadElement, p: LowDetailPaint) {
  const paper = STICKY_COLORS[el.color] ?? STICKY_COLORS[DEFAULT_COLOR];
  p.rect(PAD_STACK, PAD_STACK, el.w - PAD_STACK, el.h - PAD_STACK, paper);
  p.rect(PAD_STACK, PAD_STACK, el.w - PAD_STACK, el.h - PAD_STACK, '#17162B', 0.12);
  p.rect(0, 0, el.w - PAD_STACK, el.h - PAD_STACK, paper);
  p.rect(0, 0, el.w - PAD_STACK, (el.h - PAD_STACK) * GLUE, '#17162B', 0.06);
}

export const padDefinition = defineElement({
  type: 'stickypad',
  label: { one: 'Sticky pad', many: 'Sticky pads' },
  icon: StickyNote,
  resize: 'free',
  rotatable: false,
  minSize: { w: 96, h: 96 },
  swatch: (el) => STICKY_COLORS[el.color] ?? STICKY_COLORS.yellow,
  lowDetail: paintPad,
  sharedStyle: (el) => ({ fill: STICKY_COLORS[el.color] }),
  applySharedStyle: (_el, { fill }) => (fill ? { color: nearestColor(fill) } : null),
  defaults: (): Omit<NewElement<'stickypad'>, 'x' | 'y'> => ({
    type: 'stickypad',
    w: STICKY_SIZE + PAD_STACK,
    h: STICKY_SIZE + PAD_STACK,
    color: DEFAULT_COLOR,
  }),
  Component: PadView,
  toPlainText: () => 'Sticky pad',
});
