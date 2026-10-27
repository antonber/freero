// Bottom-right: zoom controls + canvas minimap with a draggable viewport rect.
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { Map as MapIcon, Maximize, Minus, Plus } from 'lucide-react';
import { IconButton, Menu } from '@ui';
import { STICKY_COLORS, type BoardElement } from '@freero/shared';
import { useCore } from '../context';
import { nextZoomStep, viewportRect } from '../camera/camera';
import { boundsOf, expandRect, rectUnion } from '../geometry/geometry';
import type { Rect } from '../api';
import { PanelSlotView } from './PanelSlot';

function ZoomControls() {
  const core = useCore();
  const editor = core.editor;
  const zoom = useStore(core.ui, (s) => s.camera.zoom);
  const minimapOpen = useStore(core.ui, (s) => s.minimapOpen);
  const [menuOpen, setMenuOpen] = useState(false);
  const pctRef = useRef<HTMLButtonElement>(null);
  return (
    <div className="fr-chrome-card fr-zoom" role="group" aria-label="Zoom">
      <IconButton
        icon={MapIcon}
        label={minimapOpen ? 'Hide minimap' : 'Show minimap'}
        size={32}
        tooltipSide="top"
        active={minimapOpen}
        onClick={() => core.ui.setState({ minimapOpen: !minimapOpen })}
      />
      <div className="fr-zoom__sep" />
      <IconButton icon={Minus} label="Zoom out" shortcut="Mod+-" size={32} tooltipSide="top" onClick={() => editor.runCommand('engine.zoomOut')} />
      <button ref={pctRef} type="button" className="fr-zoom__pct" aria-label="Zoom presets" onClick={() => setMenuOpen((o) => !o)}>
        {Math.round(zoom * 100)}%
      </button>
      <IconButton icon={Plus} label="Zoom in" shortcut="Mod++" size={32} tooltipSide="top" onClick={() => editor.runCommand('engine.zoomIn')} />
      <IconButton icon={Maximize} label="Fit to screen" shortcut="Shift+1" size={32} tooltipSide="top" onClick={() => editor.runCommand('engine.zoomToFit')} />
      <Menu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        anchor={pctRef.current}
        side="top"
        align="center"
        minWidth={180}
        items={[
          { id: 'fit', label: 'Zoom to fit', shortcut: 'Shift+1', onSelect: () => editor.runCommand('engine.zoomToFit') },
          {
            id: 'sel',
            label: 'Zoom to selection',
            shortcut: 'Shift+2',
            disabled: editor.getSelection().length === 0,
            onSelect: () => editor.runCommand('engine.zoomToSelection'),
          },
          { divider: true },
          ...[0.5, 1, 2].map((z) => ({
            id: `z${z}`,
            label: `${z * 100}%`,
            shortcut: z === 1 ? 'Shift+0' : undefined,
            checked: Math.abs(zoom - z) < 0.005,
            onSelect: () => editor.asUser(() => editor.zoomTo(z)),
          })),
        ]}
      />
    </div>
  );
}

function elementColor(el: BoardElement): string {
  const rec = el as unknown as Record<string, unknown>;
  if (el.type === 'sticky') return STICKY_COLORS[el.color] ?? STICKY_COLORS.yellow;
  if (el.type === 'frame') return 'rgba(255,255,255,0.9)';
  const fill = rec.fill ?? rec.color ?? rec.stroke;
  if (typeof fill === 'string' && fill !== 'transparent') return fill;
  return '#B9B7CC';
}

const MM_W = 220;
const MM_H = 150;

function Minimap() {
  const core = useCore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const world = useRef<{ rect: Rect; scale: number; ox: number; oy: number } | null>(null);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    let raf = 0;
    const draw = () => {
      raf = 0;
      const c = canvasRef.current;
      if (!c) return;
      const dpr = window.devicePixelRatio || 1;
      if (c.width !== MM_W * dpr) {
        c.width = MM_W * dpr;
        c.height = MM_H * dpr;
      }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      const { camera, viewport } = core.ui.getState();
      const els = core.store.getOrdered();
      const view = viewportRect(camera, viewport);
      const content = boundsOf(els);
      const all = expandRect(rectUnion(content ? [content, view] : [view])!, 80);
      const scale = Math.min(MM_W / all.w, MM_H / all.h);
      const ox = (MM_W - all.w * scale) / 2 - all.x * scale;
      const oy = (MM_H - all.h * scale) / 2 - all.y * scale;
      world.current = { rect: all, scale, ox, oy };
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MM_W, MM_H);
      for (const el of els) {
        ctx.fillStyle = elementColor(el);
        const w = Math.max(1.5, el.w * scale);
        const h = Math.max(1.5, el.h * scale);
        ctx.fillRect(el.x * scale + ox, el.y * scale + oy, w, h);
        if (el.type === 'frame') {
          ctx.strokeStyle = 'rgba(40,38,70,0.25)';
          ctx.lineWidth = 1;
          ctx.strokeRect(el.x * scale + ox, el.y * scale + oy, w, h);
        }
      }
      // Viewport rect, with the outside dimmed.
      const vx = view.x * scale + ox;
      const vy = view.y * scale + oy;
      const vw = view.w * scale;
      const vh = view.h * scale;
      ctx.fillStyle = 'rgba(23,22,43,0.06)';
      ctx.beginPath();
      ctx.rect(0, 0, MM_W, MM_H);
      ctx.rect(vx, vy, vw, vh);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#5b3ff0';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(vx, vy, vw, vh);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    draw();
    const off1 = core.store.subscribeElements(schedule);
    const off2 = core.ui.subscribe((s, p) => {
      if (s.camera !== p.camera || s.viewport !== p.viewport) schedule();
    });
    return () => {
      off1();
      off2();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [core]);

  const toWorld = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    const w = world.current!;
    return { x: (e.clientX - r.left - w.ox) / w.scale, y: (e.clientY - r.top - w.oy) / w.scale };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!world.current) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toWorld(e);
    const { camera, viewport } = core.ui.getState();
    const view = viewportRect(camera, viewport);
    const inside = p.x >= view.x && p.x <= view.x + view.w && p.y >= view.y && p.y <= view.y + view.h;
    if (inside) drag.current = { dx: p.x - view.x, dy: p.y - view.y };
    else {
      // Jump: center the viewport on the clicked point, then keep dragging from its center.
      drag.current = { dx: view.w / 2, dy: view.h / 2 };
      core.editor.asUser(() => core.editor.setCamera({ x: p.x - view.w / 2, y: p.y - view.h / 2, zoom: camera.zoom }, { animate: true }));
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current || !world.current) return;
    const p = toWorld(e);
    const zoom = core.ui.getState().camera.zoom;
    core.editor.asUser(() => core.editor.setCameraNow({ x: p.x - drag.current!.dx, y: p.y - drag.current!.dy, zoom }));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="fr-chrome-card fr-minimap">
      <canvas
        ref={canvasRef}
        style={{ width: MM_W, height: MM_H }}
        aria-label="Board overview"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  );
}

export function BottomRight() {
  const core = useCore();
  const minimapOpen = useStore(core.ui, (s) => s.minimapOpen);
  return (
    <div className="fr-bottomright" data-fr-chrome="" data-fr-occludes="">
      {minimapOpen && <Minimap />}
      <div className="fr-bottomright__row">
        <PanelSlotView slot="bottom-right" className="fr-chrome-card fr-slot-row" />
        <ZoomControls />
      </div>
    </div>
  );
}

export function BottomLeft() {
  return (
    <div className="fr-bottomleft" data-fr-chrome="" data-fr-occludes="">
      <PanelSlotView slot="bottom-left" className="fr-chrome-card fr-slot-row" />
    </div>
  );
}
