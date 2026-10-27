// Background grid (dots / lines) that re-spaces and cross-fades with zoom. Updated imperatively.
import { useEffect, useRef } from 'react';
import type { BoardSettings } from '@freero/shared';
import type { Camera } from '../api';
import { useCore } from '../context';

const BASE = 24;
const MIN_PX = 14;

function luminance(hex: string): number {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return 1;
  const [r, g, b] = [m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export interface GridLayers {
  /** Screen spacing of the main layer, in [MIN_PX, 4·MIN_PX). */
  major: number;
  /** Opacity of the finer layer fading in as it approaches MIN_PX. */
  minorAlpha: number;
}

export function gridLayers(zoom: number): GridLayers {
  let step = BASE;
  while (step * zoom < MIN_PX) step *= 4;
  while (step * zoom >= MIN_PX * 4 && step > BASE / 64) step /= 4;
  const major = step * zoom;
  const minor = major / 4;
  return { major, minorAlpha: Math.max(0, Math.min(1, (minor - 5) / (MIN_PX - 5))) };
}

export function gridStyle(cam: Camera, settings: BoardSettings): Partial<CSSStyleDeclaration> {
  if (settings.grid === 'none') return { backgroundImage: 'none' };
  const dark = luminance(settings.background) < 0.45;
  const ink = dark ? '255,255,255' : '40,38,70';
  const { major, minorAlpha } = gridLayers(cam.zoom);
  const minor = major / 4;
  const offX = (s: number) => `${(-cam.x * cam.zoom) % s}px`;
  const offY = (s: number) => `${(-cam.y * cam.zoom) % s}px`;
  if (settings.grid === 'dots') {
    const a = dark ? 0.22 : 0.26;
    const layers = [
      `radial-gradient(circle at 1px 1px, rgba(${ink},${a}) 1.1px, transparent 1.6px)`,
      `radial-gradient(circle at 1px 1px, rgba(${ink},${(a * minorAlpha).toFixed(3)}) 1px, transparent 1.4px)`,
    ];
    return {
      backgroundImage: layers.join(','),
      backgroundSize: `${major}px ${major}px, ${minor}px ${minor}px`,
      backgroundPosition: `${offX(major)} ${offY(major)}, ${offX(minor)} ${offY(minor)}`,
    };
  }
  const a = dark ? 0.1 : 0.08;
  const am = (a * minorAlpha * 0.7).toFixed(3);
  const line = (alpha: string | number) => [
    `linear-gradient(to right, rgba(${ink},${alpha}) 1px, transparent 1px)`,
    `linear-gradient(to bottom, rgba(${ink},${alpha}) 1px, transparent 1px)`,
  ];
  return {
    backgroundImage: [...line(a), ...line(am)].join(','),
    backgroundSize: `${major}px ${major}px, ${major}px ${major}px, ${minor}px ${minor}px, ${minor}px ${minor}px`,
    backgroundPosition: [major, major, minor, minor].map((s) => `${offX(s)} ${offY(s)}`).join(','),
  };
}

export function Grid() {
  const core = useCore();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const apply = () => {
      const el = ref.current;
      if (!el) return;
      const st = gridStyle(core.ui.getState().camera, core.store.getSettings());
      el.style.backgroundImage = st.backgroundImage ?? 'none';
      el.style.backgroundSize = st.backgroundSize ?? '';
      el.style.backgroundPosition = st.backgroundPosition ?? '';
    };
    apply();
    return core.ui.subscribe((s, p) => {
      if (s.camera !== p.camera || s.settingsVersion !== p.settingsVersion) apply();
    });
  }, [core]);
  return <div ref={ref} className="fr-grid" aria-hidden />;
}
