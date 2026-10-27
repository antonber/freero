// Screen-space overlays: they stay constant size regardless of zoom.
import { memo, type CSSProperties } from 'react';
import { useStore } from 'zustand';
import type { BoardElement, PresenceState } from '@freero/shared';
import { useCore } from '../context';
import { useCamera, useElements, usePeers, useRole, useSelectedElements } from '../hooks';
import { worldToScreen } from '../camera/camera';
import { boundsOf, rectCenter } from '../geometry/geometry';
import type { Camera } from '../api';
import { ALL_HANDLES, CORNER_HANDLES, type Handle } from '../geometry/transform';
import { Lock, RotateCw } from 'lucide-react';
import './overlays.css';

const HANDLE_ANGLE: Record<Handle, number> = { n: 0, ne: 45, e: 90, se: 135, s: 180, sw: 225, w: 270, nw: 315 };
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize'];

function handleCursor(h: Handle, rotation: number): string {
  const a = (((HANDLE_ANGLE[h] + rotation) % 180) + 180) % 180;
  return CURSORS[Math.round(a / 45) % 4];
}

/** Absolutely positioned, rotated box in screen space matching an element. */
function boxStyle(el: Pick<BoardElement, 'x' | 'y' | 'w' | 'h' | 'rotation'>, cam: Camera, pad = 0): CSSProperties {
  const c = worldToScreen(cam, rectCenter(el));
  const w = el.w * cam.zoom + pad * 2;
  const h = el.h * cam.zoom + pad * 2;
  return {
    width: w,
    height: h,
    transform: `translate(${c.x - w / 2}px, ${c.y - h / 2}px)${el.rotation ? ` rotate(${el.rotation}deg)` : ''}`,
  };
}

function handlesFor(core: ReturnType<typeof useCore>, els: BoardElement[], screenW: number, screenH: number): Handle[] {
  if (els.length !== 1) return CORNER_HANDLES;
  const mode = core.editor.getDefinition(els[0].type)?.resize ?? 'free';
  const small = screenW < 36 || screenH < 36;
  switch (mode) {
    case 'free':
      return small ? CORNER_HANDLES : ALL_HANDLES;
    case 'aspect':
      return CORNER_HANDLES;
    case 'scale':
      return small ? CORNER_HANDLES : [...CORNER_HANDLES, 'e', 'w'];
    case 'width-only':
      return ['e', 'w'];
    default:
      return [];
  }
}

function SelectionOverlay() {
  const core = useCore();
  const cam = useCamera();
  const els = useSelectedElements();
  const role = useRole();
  const transforming = useStore(core.ui, (s) => s.transforming);
  const editingId = useStore(core.ui, (s) => s.editingId);
  if (!els.length) return null;
  const canEdit = role === 'editor' || role === 'owner';
  const single = els.length === 1;
  // A type that draws its own selection chrome (connector endpoints) gets no box from us.
  const ownFrame = (el: BoardElement) => core.editor.getDefinition(el.type)?.selectionFrame === false;
  if (single && ownFrame(els[0])) return null;
  const box = single ? els[0] : { ...boundsOf(els)!, rotation: 0 };
  const style = boxStyle(box, cam, 0);
  const W = box.w * cam.zoom;
  const H = box.h * cam.zoom;
  const locked = els.some((e) => e.locked);
  const showHandles = canEdit && !locked && !editingId && transforming !== 'translate' && transforming !== 'marquee';
  const handles = showHandles ? handlesFor(core, els, W, H) : [];
  const rotatable =
    showHandles && els.every((e) => core.editor.getDefinition(e.type)?.rotatable !== false) && transforming !== 'resize';
  return (
    <>
      {!single &&
        els
          .filter((el) => !ownFrame(el))
          .map((el) => (
            <div key={el.id} className={`fr-ov-outline fr-ov-outline--member${el.locked ? ' is-locked' : ''}`} style={boxStyle(el, cam)}>
              {el.locked && (
                <div className="fr-ov-lock" title="Locked">
                  <Lock size={11} strokeWidth={2.4} />
                </div>
              )}
            </div>
          ))}
      <div className={`fr-ov-selection${editingId ? ' is-editing' : ''}${locked ? ' is-locked' : ''}`} style={style}>
        {handles.map((h) => (
          <div
            key={h}
            data-handle={h}
            className={`fr-ov-handle fr-ov-handle--${h.length === 2 ? 'corner' : h === 'e' || h === 'w' ? 'side-v' : 'side-h'} fr-ov-handle--${h}`}
            style={{ cursor: handleCursor(h, box.rotation || 0) }}
          />
        ))}
        {rotatable && transforming !== 'rotate' && (
          <div data-handle="rotate" className="fr-ov-rotate" title="Rotate (Shift snaps to 15°)">
            <RotateCw size={12} strokeWidth={2.4} />
          </div>
        )}
        {locked && single && <div className="fr-ov-lock" title="Locked"><Lock size={11} strokeWidth={2.4} /></div>}
      </div>
    </>
  );
}

function HoverOverlay() {
  const core = useCore();
  const cam = useCamera();
  const hoverId = useStore(core.ui, (s) => (s.transforming ? null : s.hoverId));
  const selected = useStore(core.ui, (s) => (hoverId ? s.selection.includes(hoverId) : false));
  const dropId = useStore(core.ui, (s) => s.dropTargetId);
  useElements(); // follow element moves
  const hovered = hoverId && !selected ? core.store.getElement(hoverId) : undefined;
  const hover = hovered && core.editor.getDefinition(hovered.type)?.selectionFrame !== false ? hovered : undefined;
  const drop = dropId ? core.store.getElement(dropId) : undefined;
  return (
    <>
      {hover && <div className="fr-ov-outline fr-ov-outline--hover" style={boxStyle(hover, cam)} />}
      {drop && <div className="fr-ov-outline fr-ov-outline--drop" style={boxStyle(drop, cam, 2)} />}
    </>
  );
}

function GuidesOverlay() {
  const core = useCore();
  const cam = useCamera();
  const guides = useStore(core.ui, (s) => s.guides);
  const gaps = useStore(core.ui, (s) => s.gaps);
  const marquee = useStore(core.ui, (s) => s.marquee);
  const hint = useStore(core.ui, (s) => s.hint);
  return (
    <>
      {guides.map((g, i) => {
        if (g.axis === 'x') {
          const a = worldToScreen(cam, { x: g.pos, y: g.from });
          const b = worldToScreen(cam, { x: g.pos, y: g.to });
          return <div key={i} className="fr-ov-guide" style={{ left: a.x, top: a.y, width: 1, height: Math.max(1, b.y - a.y) }} />;
        }
        const a = worldToScreen(cam, { x: g.from, y: g.pos });
        const b = worldToScreen(cam, { x: g.to, y: g.pos });
        return <div key={i} className="fr-ov-guide" style={{ left: a.x, top: a.y, height: 1, width: Math.max(1, b.x - a.x) }} />;
      })}
      {gaps.map((g, i) => {
        // Equal-spacing marker: a measure line with end ticks and the distance in world units.
        const horizontal = g.axis === 'x';
        const a = worldToScreen(cam, horizontal ? { x: g.from, y: g.at } : { x: g.at, y: g.from });
        const b = worldToScreen(cam, horizontal ? { x: g.to, y: g.at } : { x: g.at, y: g.to });
        const len = horizontal ? b.x - a.x : b.y - a.y;
        if (len < 2) return null;
        return (
          <div
            key={`gap${i}`}
            className={`fr-ov-gap fr-ov-gap--${horizontal ? 'h' : 'v'}`}
            style={horizontal ? { left: a.x, top: a.y, width: len } : { left: a.x, top: a.y, height: len }}
          >
            <span className="fr-ov-gap__label">{Math.round(g.to - g.from)}</span>
          </div>
        );
      })}
      {marquee && (() => {

        const a = worldToScreen(cam, marquee);
        return <div className="fr-ov-marquee" style={{ left: a.x, top: a.y, width: marquee.w * cam.zoom, height: marquee.h * cam.zoom }} />;
      })()}
      {hint && (
        <div className="fr-ov-hint" style={{ transform: `translate(${hint.x + 14}px, ${hint.y + 18}px)` }}>
          {hint.text}
        </div>
      )}
    </>
  );
}

const PeerCursor = memo(function PeerCursor({ peer, cam }: { peer: PresenceState; cam: Camera }) {
  if (!peer.cursor) return null;
  const p = worldToScreen(cam, peer.cursor);
  return (
    <div className="fr-ov-cursor" style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
      <svg width="18" height="20" viewBox="0 0 18 20" aria-hidden>
        <path d="M2 1.5 L16 9.2 L9.4 10.6 L6.2 17.6 Z" fill={peer.user.color} stroke="white" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="fr-ov-cursor-name" style={{ background: peer.user.color }}>
        {peer.user.name}
      </span>
    </div>
  );
});

function PeersOverlay() {
  const core = useCore();
  const cam = useCamera();
  const peers = usePeers();
  useElements();
  return (
    <>
      {peers.map((peer) => {
        const ids = new Set([...(peer.selection ?? []), ...(peer.editingId ? [peer.editingId] : [])]);
        const els = [...ids].map((id) => core.store.getElement(id)).filter((e): e is BoardElement => !!e);
        return els.map((el, i) => (
          <div
            key={`${peer.clientId}:${el.id}`}
            className="fr-ov-outline fr-ov-outline--peer"
            style={{ ...boxStyle(el, cam, 2), borderColor: peer.user.color }}
          >
            {i === 0 && (
              <span className="fr-ov-peer-tag" style={{ background: peer.user.color }}>
                {peer.user.name}
                {peer.editingId === el.id ? ' is typing…' : ''}
              </span>
            )}
          </div>
        ));
      })}
      {peers.map((peer) => (
        <PeerCursor key={peer.clientId} peer={peer} cam={cam} />
      ))}
    </>
  );
}

export function ScreenOverlays() {
  const chromeHidden = useStore(useCore().ui, (s) => s.chromeHidden);
  return (
    <div className="fr-overlays">
      <PeersOverlay />
      {!chromeHidden && (
        <>
          <HoverOverlay />
          <SelectionOverlay />
          <GuidesOverlay />
        </>
      )}
    </div>
  );
}
