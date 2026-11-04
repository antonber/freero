// Contextual format toolbar floating above the selection (flips below when there's no room).
// Feature format sections first (by order), then the engine's common controls.
import { Fragment, memo, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useStore } from 'zustand';
import { Copy, Ellipsis, Group, Layers, Lock, LockOpen, Share, ShieldCheck, Trash2, Ungroup } from 'lucide-react';
import { isProtectedLock } from '@freero/shared';
import { IconButton, Menu, type MenuItem } from '@ui';
import { ScopeContext, useCore } from '../context';
import { useCamera, useRole, useSelectedElements } from '../hooks';
import { screenToWorld, worldToScreen } from '../camera/camera';
import { boundsOf, elementAABB } from '../geometry/geometry';
import type { BoardElement } from '@freero/shared';
import type { Camera, Editor, Rect } from '../api';
import type { EngineCore } from '../runtime/core';
import { ROLE_RANK } from '../runtime/core';
import { isMac } from '../runtime/shortcuts';
import { contextCommandItems } from './ContextMenu';
import { ExactControls } from './ExactControls';
import { MixedStyleSection, hasMixedStyle } from './MixedStyle';
import { useCompactLayout } from './compact';

import { t as tr } from '../messages';
const GAP = 14;
const TOP_SAFE = 68;
/** How far (screen px) the toolbar may move from its natural spot to keep nearby items clickable. */
const MAX_DETOUR = 160;

type ScreenRect = { x: number; y: number; w: number; h: number };

/**
 * Screen rects of the unselected items around the selection that the toolbar could cover.
 * Ignores containers (frames) and anything overlapping the selection itself (a shape it sits
 * on, its connectors): those can't be avoided by moving the toolbar up or down.
 */
function nearbyItemRects(
  editor: Editor,
  cam: Camera,
  n: { left: number; selTop: number; selBottom: number },
  size: { w: number; h: number },
  ids: string[],
): ScreenRect[] {
  const selected = new Set(ids);
  const sel = editor.getBounds(ids);
  if (!sel) return [];
  const tl = screenToWorld(cam, { x: n.left, y: n.selTop - MAX_DETOUR - size.h - GAP });
  const br = screenToWorld(cam, { x: n.left + size.w, y: n.selBottom + MAX_DETOUR + size.h + GAP + 34 });
  const overlapsSel = (r: Rect) => r.x < sel.x + sel.w && r.x + r.w > sel.x && r.y < sel.y + sel.h && r.y + r.h > sel.y;
  return editor
    .elementsInRect({ x: tl.x, y: tl.y, w: br.x - tl.x, h: br.y - tl.y }, 'intersect')
    .filter((el) => !selected.has(el.id) && !editor.getDefinition(el.type)?.container)
    .map(elementAABB)
    .filter((r) => !overlapsSel(r))
    .map((r) => {
      const a = worldToScreen(cam, r);
      const b = worldToScreen(cam, { x: r.x + r.w, y: r.y + r.h });
      return { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    });
}

/**
 * Screen rects (viewport px) of world/screen UI that must stay visible above a selection, e.g.
 * comment pins: any node marked `data-fr-keep-clear` inside the board. The toolbar steps above
 * them (or flips below the selection) instead of covering them.
 */
function keepClearRects(viewport: HTMLElement | null): Array<{ x: number; y: number; w: number; h: number }> {
  const root = viewport?.parentElement;
  if (!viewport || !root) return [];
  const base = viewport.getBoundingClientRect();
  return [...root.querySelectorAll<HTMLElement>('[data-fr-keep-clear]')].map((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
  });
}

export function FormatToolbar() {
  const core = useCore();
  const editor = core.editor;
  const els = useSelectedElements();
  const cam = useCamera();
  const role = useRole();
  const transforming = useStore(core.ui, (s) => s.transforming);
  const contextMenu = useStore(core.ui, (s) => s.contextMenu);
  const viewport = useStore(core.ui, (s) => s.viewport);
  // The format sections show the text editor's caret state (bold, link…): refreshed with it.
  const textVersion = useStore(core.ui, (s) => s.textStateVersion);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 44 });
  /** Toolbar top chosen to clear keep-clear nodes (null = the default placement is clear). */
  const [clearTop, setClearTop] = useState<number | null>(null);
  const natural = useRef<{ left: number; top: number; below: boolean; selTop: number; selBottom: number } | null>(null);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const arrangeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const compact = useCompactLayout();
  const phoneEditing = useStore(core.ui, (s) => s.phoneEditing);
  // A guest editor (#97) formats what it added itself (Editor.mayEdit).
  const guestEdit = useStore(core.ui, (s) => s.guestEdit);
  const mayFormat = ROLE_RANK[role] >= ROLE_RANK.editor || (guestEdit && editor.mayEdit(els.map((e) => e.id)));
  // Phone, view-and-comment mode: no format toolbar until the editor switches to editing.
  const visible = els.length > 0 && !transforming && !contextMenu && mayFormat && (!compact || phoneEditing || guestEdit);
  // What depends on the selection only is worked out when it changes, never per camera frame: the
  // toolbar follows every pan and zoom, and with ten thousand items selected each pass over them
  // costs milliseconds (docs/performance.md).
  const sections = useMemo(() => (visible ? core.registry.formats.filter((f) => f.def.appliesTo(els)) : []), [core, visible, els]);
  // Several item types selected: the style controls they share (KAI-111), before the features'.
  const mixed = useMemo(() => visible && hasMixedStyle(editor, els), [editor, visible, els]);
  const ids = useMemo(() => els.map((e) => e.id), [els]);
  // Visual bounds: clear of what elements draw outside their box (a frame's title above it).
  const bounds = useMemo(() => (visible ? (editor.getBounds(ids, { visual: true }) ?? boundsOf(els)) : null), [editor, visible, ids, els, cam.zoom]);

  useLayoutEffect(() => {
    if (!ref.current) return;
    // Layout size, not the painted one: the entrance animation scales the toolbar down for a moment.
    const r = { width: ref.current.offsetWidth, height: ref.current.offsetHeight };
    if (Math.abs(r.width - size.w) > 0.5 || Math.abs(r.height - size.h) > 0.5) setSize({ w: r.width, h: r.height });
  });

  // Publish where we are (useFormatToolbarRect) so screen UI can stay clear of the toolbar.
  const placed = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  placed.current = null;
  natural.current = null;
  useLayoutEffect(() => {
    const r = placed.current;
    const p = core.ui.getState().formatToolbarRect;
    if (r?.x !== p?.x || r?.y !== p?.y || r?.w !== p?.w || r?.h !== p?.h) core.ui.setState({ formatToolbarRect: r });
  });
  useLayoutEffect(() => () => core.ui.setState({ formatToolbarRect: null }), [core]);

  // Step clear of what the natural placement would cover: keep-clear nodes (comment pins, the top
  // quick-connect "+") must stay visible; other items near the selection (a mind-map sibling right
  // above) should stay clickable when a spot close by is free.
  useLayoutEffect(() => {
    const n = natural.current;
    let next: number | null = null;
    if (n) {
      const inSpan = (p: ScreenRect) => p.x < n.left + size.w + 6 && p.x + p.w > n.left - 6;
      const pins = keepClearRects(core.dom.viewport).filter(inSpan);
      const items = nearbyItemRects(core.editor, cam, n, size, ids).filter(inSpan);
      const hits = (list: ScreenRect[], top: number) => list.filter((p) => p.y < top + size.h + 6 && p.y + p.h > top - 6);
      const fits = (top: number) => top >= TOP_SAFE && top + size.h <= viewport.height - 70;
      /** Above the selection, climbing over whatever of `list` is in the way. */
      const climb = (list: ScreenRect[]) => {
        let top = n.top;
        for (let i = 0; i < 8 && hits(list, top).length; i++) top = Math.min(...hits(list, top).map((p) => p.y)) - 8 - size.h;
        return n.below ? null : top;
      };
      /** Below the selection (clear of the rotate handle), stepping down past `list`. */
      const descend = (list: ScreenRect[]) => {
        let top = n.selBottom + GAP + 34;
        for (let i = 0; i < 8 && hits(list, top).length; i++) top = Math.max(...hits(list, top).map((p) => p.y + p.h)) + 8;
        return top;
      };
      const pinned = hits(pins, n.top).length > 0;
      if (pinned || hits(items, n.top).length) {
        const all = [...pins, ...items];
        const near = (top: number) => top >= n.top - MAX_DETOUR && top <= n.selBottom + GAP + 34 + MAX_DETOUR;
        const clearOfAll = [climb(all), descend(all)].find(
          (t): t is number => t !== null && fits(t) && near(t) && !hits(all, t).length,
        );
        if (clearOfAll !== undefined) next = clearOfAll;
        else if (pinned) {
          // No free spot nearby: covering items is acceptable, covering a pin is not.
          next = [climb(pins), descend(pins)].find((t): t is number => t !== null && fits(t) && !hits(pins, t).length) ?? null;
        }
      }
    }
    if (next !== clearTop) setClearTop(next);
  });

  if (!visible || !bounds) return null;
  const b = bounds;
  const tl = worldToScreen(cam, b);
  const br = worldToScreen(cam, { x: b.x + b.w, y: b.y + b.h });
  const cx = (tl.x + br.x) / 2;
  let top = tl.y - GAP - size.h;
  let below = false;
  if (top < TOP_SAFE) {
    top = br.y + GAP + 34; // leave room for the rotate handle
    below = true;
  }
  if (below && top + size.h > viewport.height - 70) top = Math.max(TOP_SAFE, Math.min(tl.y + 8, viewport.height - size.h - 70));
  // Clear of the left toolbar on wide screens; on a phone the toolbar sits at the bottom.
  // A toolbar wider than the window (big touch targets on a tablet) starts at the left edge and scrolls.
  const left = compact
    ? Math.max(8, Math.min(cx - size.w / 2, viewport.width - size.w - 8))
    : Math.max(12, Math.min(Math.max(12 + 56, cx - size.w / 2), viewport.width - size.w - 12));
  natural.current = { left, top, below, selTop: tl.y, selBottom: br.y };
  if (clearTop !== null) top = clearTop;
  placed.current = { x: Math.round(left), y: Math.round(top), w: size.w, h: size.h };
  const arrangeItems: MenuItem[] = [
    { id: 'front', label: tr('bringToFront'), shortcut: 'Mod+]', onSelect: () => editor.bringToFront(ids) },
    // On macOS the browser may take Mod+Shift+] / [ (tab switch): show the key that always works there.
    { id: 'forward', label: tr('bringForward'), shortcut: isMac ? 'Mod+Alt+ArrowUp' : tr('modShift'), onSelect: () => editor.bringForward(ids) },
    { id: 'backward', label: tr('sendBackward'), shortcut: isMac ? 'Mod+Alt+ArrowDown' : tr('modShift2'), onSelect: () => editor.sendBackward(ids) },
    { id: 'back', label: tr('sendToBack'), shortcut: 'Mod+[', onSelect: () => editor.sendToBack(ids) },
  ];

  return (
    // A landmark around the floating toolbar, so its content is in one like the rest of the chrome
    // (screen-reader region navigation finds it). `display: contents`: it adds no box.
    <div className="fr-format-region" role="region" aria-label={tr('format')}>
      <div
        ref={ref}
        className="fr-format"
        style={{ left: Math.round(left), top: Math.round(top) }}
        data-fr-format-toolbar=""
        data-fr-region="format"
        data-fr-chrome=""
        role="toolbar"
        aria-label={tr('format')}
        onMouseDown={(e) => {
          // Keep the text editor's selection: clicks here must not steal focus.
          const t = e.target as HTMLElement;
          if (!t.closest('input, textarea, select')) e.preventDefault();
        }}
      >
        <ToolbarBody
          core={core}
          role={role}
          textVersion={textVersion}
          els={els}
          ids={ids}
          mixed={mixed}
          sections={sections}
          arrangeRef={arrangeRef}
          moreRef={moreRef}
          arrangeOpen={arrangeOpen}
          moreOpen={moreOpen}
          setArrangeOpen={setArrangeOpen}
          setMoreOpen={setMoreOpen}
        />
        <Menu open={arrangeOpen} onClose={() => setArrangeOpen(false)} anchor={arrangeRef.current} items={arrangeItems} side="bottom" align="center" />
        <Menu
          open={moreOpen}
          onClose={() => setMoreOpen(false)}
          anchor={moreRef.current}
          items={moreOpen ? contextCommandItems(core, { withZOrder: false }) : []}
          side="bottom"
          align="end"
          minWidth={220}
        />
      </div>
    </div>
  );
}

/**
 * The toolbar's controls: the format sections and the common buttons. Memoized apart from the
 * floating wrapper, so a camera move (which only moves the wrapper) re-renders none of them.
 */
const ToolbarBody = memo(function ToolbarBody({
  core,
  els,
  ids,
  mixed,
  sections,
  arrangeRef,
  moreRef,
  arrangeOpen,
  moreOpen,
  setArrangeOpen,
  setMoreOpen,
}: {
  core: EngineCore;
  /** Re-render on these: what may be done, and the caret's format state. */
  role: string;
  textVersion: number;
  els: BoardElement[];
  ids: string[];
  mixed: boolean;
  sections: EngineCore['registry']['formats'];
  arrangeRef: RefObject<HTMLButtonElement>;
  moreRef: RefObject<HTMLButtonElement>;
  arrangeOpen: boolean;
  moreOpen: boolean;
  setArrangeOpen: (f: (o: boolean) => boolean) => void;
  setMoreOpen: (f: (o: boolean) => boolean) => void;
}) {
  const editor = core.editor;
  const locked = els.every((e) => e.locked);
  const someLocked = !locked && els.some((e) => e.locked);
  // A protected lock (BaseElement.lockProtected) only the owner lifts.
  const held = locked && els.some(isProtectedLock) && !editor.mayProtect();
  const canRun = (id: string) => {
    const reg = core.registry.commands.get(id);
    return !!reg && (!reg.def.when || reg.def.when(core.scoped(reg.feature)));
  };
  const canGroup = canRun('engine.group');
  const canUngroup = canRun('engine.ungroup');
  return (
    <>
      {!locked && mixed && (
        <>
          <div className="fr-format__section">
            <MixedStyleSection editor={editor} selection={els} />
          </div>
          {sections.length > 0 && <div className="fr-format__sep" />}
        </>
      )}
      {!locked &&
        sections.map(({ def, feature }, i) => (
          <Fragment key={def.id}>
            {i > 0 && <div className="fr-format__sep" />}
            <ScopeContext.Provider value={feature}>
              <div className="fr-format__section">
                <def.Component editor={core.scoped(feature)} selection={els} />
              </div>
            </ScopeContext.Provider>
          </Fragment>
        ))}
      {!locked && (mixed || sections.length > 0) && <div className="fr-format__sep" />}
      <div className="fr-format__section">
        {!locked && (
          <IconButton ref={arrangeRef} icon={Layers} label={tr('arrange')} size={32} active={arrangeOpen} onClick={() => setArrangeOpen((o) => !o)} />
        )}
        {!locked && <ExactControls editor={editor} selection={els} />}
        {!locked && canGroup && <IconButton icon={Group} label={tr('group')} shortcut="Mod+G" size={32} onClick={() => editor.runCommand('engine.group')} />}
        {!locked && canUngroup && (
          <IconButton icon={Ungroup} label={tr('ungroup')} shortcut="Mod+Shift+G" size={32} onClick={() => editor.runCommand('engine.ungroup')} />
        )}
        <IconButton
          icon={held ? ShieldCheck : locked ? LockOpen : Lock}
          label={held ? tr('lockedByTheBoardOwner') : locked ? tr('unlock') : someLocked ? tr('lockAllSomeAreLocked') : tr('lock')}
          className={someLocked ? 'fr-format__partial' : undefined}
          disabled={held}

          shortcut="Mod+Shift+L"
          size={32}
          active={locked}
          onClick={() => editor.runCommand('engine.lock')}
        />
        {els.length === 1 && <IconButton icon={Share} label={tr('copyLinkToItem')} size={32} onClick={() => editor.runCommand('engine.copyLink')} />}
        {!locked && <IconButton icon={Copy} label={tr('duplicate')} shortcut="Mod+D" size={32} onClick={() => editor.duplicate(ids)} />}
        {!locked && <IconButton icon={Trash2} label="Delete" shortcut="Del" size={32} onClick={() => editor.runCommand('engine.delete')} />}
        <IconButton ref={moreRef} icon={Ellipsis} label={tr('more')} size={32} active={moreOpen} onClick={() => setMoreOpen((o) => !o)} />
      </div>
    </>
  );
});
