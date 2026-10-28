// Contextual format toolbar floating above the selection (flips below when there's no room).
// Feature format sections first (by order), then the engine's common controls.
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Copy, Ellipsis, Group, Layers, Lock, LockOpen, Share, Trash2, Ungroup } from 'lucide-react';
import { IconButton, Menu, type MenuItem } from '@ui';
import { ScopeContext, useCore } from '../context';
import { useCamera, useRole, useSelectedElements } from '../hooks';
import { worldToScreen } from '../camera/camera';
import { boundsOf } from '../geometry/geometry';
import { ROLE_RANK } from '../runtime/core';
import { contextCommandItems } from './ContextMenu';

const GAP = 14;
const TOP_SAFE = 68;

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
  useStore(core.ui, (s) => s.textStateVersion);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 44 });
  /** Toolbar top chosen to clear keep-clear nodes (null = the default placement is clear). */
  const [clearTop, setClearTop] = useState<number | null>(null);
  const natural = useRef<{ left: number; top: number; below: boolean; selTop: number; selBottom: number } | null>(null);
  const [arrangeOpen, setArrangeOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const arrangeRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  const visible = els.length > 0 && !transforming && !contextMenu && ROLE_RANK[role] >= ROLE_RANK.editor;
  const sections = visible ? core.registry.formats.filter((f) => f.def.appliesTo(els)) : [];

  useLayoutEffect(() => {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
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

  // Step clear of keep-clear nodes (comment pins…) that the natural placement would cover.
  useLayoutEffect(() => {
    const n = natural.current;
    let next: number | null = null;
    if (n) {
      const pins = keepClearRects(core.dom.viewport).filter((p) => p.x < n.left + size.w + 6 && p.x + p.w > n.left - 6);
      const hits = (top: number) => pins.filter((p) => p.y < top + size.h + 6 && p.y + p.h > top - 6);
      if (hits(n.top).length) {
        // Above the selection: climb over the pins in the way; else try below the selection.
        let top = n.top;
        for (let i = 0; i < 8 && hits(top).length; i++) top = Math.min(...hits(top).map((p) => p.y)) - 8 - size.h;
        if (!n.below && top >= TOP_SAFE && !hits(top).length) next = top;
        else {
          const below = n.selBottom + GAP + 34;
          if (!hits(below).length && below + size.h <= viewport.height - 70) next = below;
        }
      }
    }
    if (next !== clearTop) setClearTop(next);
  });

  if (!visible) return null;
  // Visual bounds: clear of what elements draw outside their box (a frame's title above it).
  const b = editor.getBounds(els.map((e) => e.id), { visual: true }) ?? boundsOf(els)!;
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
  const left = Math.min(Math.max(12 + 56, cx - size.w / 2), viewport.width - size.w - 12);
  natural.current = { left, top, below, selTop: tl.y, selBottom: br.y };
  if (clearTop !== null) top = clearTop;
  placed.current = { x: Math.round(left), y: Math.round(top), w: size.w, h: size.h };
  const locked = els.every((e) => e.locked);
  const someLocked = !locked && els.some((e) => e.locked);
  const ids = els.map((e) => e.id);
  const canRun = (id: string) => {
    const reg = core.registry.commands.get(id);
    return !!reg && (!reg.def.when || reg.def.when(core.scoped(reg.feature)));
  };
  const canGroup = canRun('engine.group');
  const canUngroup = canRun('engine.ungroup');

  const arrangeItems: MenuItem[] = [
    { id: 'front', label: 'Bring to front', shortcut: 'Mod+]', onSelect: () => editor.bringToFront(ids) },
    { id: 'back', label: 'Send to back', shortcut: 'Mod+[', onSelect: () => editor.sendToBack(ids) },
  ];

  return (
    <div
      ref={ref}
      className="fr-format"
      style={{ left: Math.round(left), top: Math.round(top) }}
      data-fr-format-toolbar=""
      data-fr-chrome=""
      role="toolbar"
      aria-label="Format"
      onMouseDown={(e) => {
        // Keep the text editor's selection: clicks here must not steal focus.
        const t = e.target as HTMLElement;
        if (!t.closest('input, textarea, select')) e.preventDefault();
      }}
    >
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
      {!locked && sections.length > 0 && <div className="fr-format__sep" />}
      <div className="fr-format__section">
        {!locked && (
          <IconButton ref={arrangeRef} icon={Layers} label="Arrange" size={32} active={arrangeOpen} onClick={() => setArrangeOpen((o) => !o)} />
        )}
        {!locked && canGroup && <IconButton icon={Group} label="Group" shortcut="Mod+G" size={32} onClick={() => editor.runCommand('engine.group')} />}
        {!locked && canUngroup && (
          <IconButton icon={Ungroup} label="Ungroup" shortcut="Mod+Shift+G" size={32} onClick={() => editor.runCommand('engine.ungroup')} />
        )}
        <IconButton
          icon={locked ? LockOpen : Lock}
          label={locked ? 'Unlock' : someLocked ? 'Lock all (some are locked)' : 'Lock'}
          className={someLocked ? 'fr-format__partial' : undefined}

          shortcut="Mod+Shift+L"
          size={32}
          active={locked}
          onClick={() => editor.runCommand('engine.lock')}
        />
        {els.length === 1 && <IconButton icon={Share} label="Copy link to item" size={32} onClick={() => editor.runCommand('engine.copyLink')} />}
        {!locked && <IconButton icon={Copy} label="Duplicate" shortcut="Mod+D" size={32} onClick={() => editor.duplicate(ids)} />}
        {!locked && <IconButton icon={Trash2} label="Delete" shortcut="Del" size={32} onClick={() => editor.runCommand('engine.delete')} />}
        <IconButton ref={moreRef} icon={Ellipsis} label="More" size={32} active={moreOpen} onClick={() => setMoreOpen((o) => !o)} />
      </div>
      <Menu open={arrangeOpen} onClose={() => setArrangeOpen(false)} anchor={arrangeRef.current} items={arrangeItems} side="bottom" align="center" />
      <Menu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        anchor={moreRef.current}
        items={contextCommandItems(core, { withZOrder: false })}
        side="bottom"
        align="end"
        minWidth={220}
      />
    </div>
  );
}
