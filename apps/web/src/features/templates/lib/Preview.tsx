// Mini SVG thumbnail drawn from the template's own element data (no image files): the same
// data that gets inserted, simplified to boxes, pills and text bars.
import { memo, type ReactNode } from 'react';
import { STICKY_COLORS, type BoardElement, type StickyColor } from '@freero/shared';
import type { NewElement } from '@engine';
import { boundsOf } from './place';
import type { TemplateDef } from './types';

const cache = new Map<string, NewElement[]>();

function elementsFor(def: TemplateDef): NewElement[] {
  let els = cache.get(def.id);
  if (!els) {
    let n = 0;
    els = def.build(() => `p${n++}`);
    cache.set(def.id, els);
  }
  return els;
}

type El = NewElement & Partial<Pick<BoardElement, 'id'>>;

/** Grey bars standing in for text lines. */
const DARK = 'rgba(23,22,43,0.55)';
const SOFT = 'rgba(23,22,43,0.22)';
const LIGHT = 'rgba(255,255,255,0.8)';

function textBars(x: number, y: number, w: number, h: number, size: number, fill: string, center: boolean, key: string): ReactNode {
  const lineH = size * 1.45;
  const lines = Math.max(1, Math.min(6, Math.floor(h / lineH)));
  const bars: ReactNode[] = [];
  for (let i = 0; i < lines; i++) {
    const bw = w * (i === lines - 1 && lines > 1 ? 0.55 : 0.85);
    bars.push(
      <rect
        key={`${key}-${i}`}
        x={center ? x + (w - bw) / 2 : x}
        y={y + (h - lines * lineH) / 2 + i * lineH + size * 0.3}
        width={bw}
        height={size * 0.62}
        rx={size * 0.3}
        fill={fill}
      />,
    );
  }
  return bars;
}

function shapePath(el: NewElement<'shape'>): ReactNode {
  const { x, y, w, h } = el;
  const common = { fill: el.fill === 'transparent' ? 'none' : el.fill, stroke: el.stroke === 'transparent' ? 'none' : el.stroke, strokeWidth: el.strokeWidth };
  switch (el.shape) {
    case 'ellipse':
      return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} {...common} />;
    case 'diamond':
      return <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} {...common} />;
    case 'chevron': {
      const t = Math.min(h / 2, w / 4);
      return <polygon points={`${x},${y} ${x + w - t},${y} ${x + w},${y + h / 2} ${x + w - t},${y + h} ${x},${y + h} ${x + t},${y + h / 2}`} {...common} />;
    }
    default:
      return <rect x={x} y={y} width={w} height={h} rx={el.shape === 'roundRect' ? Math.min(16, h / 4) : 0} {...common} />;
  }
}

function connectorPath(el: NewElement<'connector'>): string {
  const s = el.start;
  const e = el.end;
  if (el.routing === 'straight') return `M${s.x},${s.y} L${e.x},${e.y}`;
  const vertical = s.anchor === 'top' || s.anchor === 'bottom';
  if (el.routing === 'curved') {
    return vertical
      ? `M${s.x},${s.y} C${s.x},${e.y} ${s.x},${e.y} ${e.x},${e.y}`
      : `M${s.x},${s.y} C${(s.x + e.x) / 2},${s.y} ${(s.x + e.x) / 2},${e.y} ${e.x},${e.y}`;
  }
  return vertical ? `M${s.x},${s.y} V${e.y} H${e.x}` : `M${s.x},${s.y} H${(s.x + e.x) / 2} V${e.y} H${e.x}`;
}

function draw(el: El, byId: Map<string, El>): ReactNode {
  const key = el.id ?? `${el.type}-${el.x}-${el.y}`;
  switch (el.type) {
    case 'frame': {
      const f = el as NewElement<'frame'>;
      return <rect key={key} x={f.x} y={f.y} width={f.w} height={f.h} rx={12} fill={f.fill} stroke="#DCDAE8" strokeWidth={4} />;
    }
    case 'sticky': {
      const s = el as NewElement<'sticky'>;
      const pad = s.w * 0.14;
      return (
        <g key={key}>
          <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={4} fill={STICKY_COLORS[s.color as StickyColor] ?? STICKY_COLORS.yellow} />
          {s.text && textBars(s.x + pad, s.y + pad, s.w - pad * 2, s.h - pad * 2, Math.max(14, s.h / 9), SOFT, true, key)}
        </g>
      );
    }
    case 'shape': {
      const s = el as NewElement<'shape'>;
      const size = typeof s.fontSize === 'number' ? s.fontSize : 18;
      const light = s.textColor.toUpperCase() === '#FFFFFF';
      return (
        <g key={key}>
          {shapePath(s)}
          {s.text && textBars(s.x + s.w * 0.18, s.y + s.h * 0.22, s.w * 0.64, s.h * 0.56, size, light ? LIGHT : DARK, true, key)}
        </g>
      );
    }
    case 'text': {
      const t = el as NewElement<'text'>;
      return <g key={key}>{textBars(t.x, t.y, Math.min(t.w, t.text.length * t.fontSize * 0.55), t.h, t.fontSize, t.fontSize >= 20 ? DARK : SOFT, t.align === 'center', key)}</g>;
    }
    case 'card': {
      const c = el as NewElement<'card'>;
      return (
        <g key={key}>
          <rect x={c.x} y={c.y} width={c.w} height={c.h} rx={8} fill="#FFFFFF" stroke="#DCDAE8" strokeWidth={2} />
          <rect x={c.x} y={c.y} width={8} height={c.h} rx={4} fill={c.color} />
          <rect x={c.x + 24} y={c.y + c.h * 0.24} width={c.w * 0.6} height={14} rx={7} fill="rgba(23,22,43,0.6)" />
          <rect x={c.x + 24} y={c.y + c.h * 0.58} width={c.w * 0.45} height={10} rx={5} fill="rgba(23,22,43,0.2)" />
        </g>
      );
    }
    case 'emoji': {
      const e = el as NewElement<'emoji'>;
      return (
        <text key={key} x={e.x + e.w / 2} y={e.y + e.h * 0.82} fontSize={e.h * 0.85} textAnchor="middle">
          {e.emoji.startsWith('stamp:') ? '★' : e.emoji}
        </text>
      );
    }
    case 'mindmap': {
      const m = el as NewElement<'mindmap'>;
      const parent = m.parentId ? byId.get(m.parentId) : undefined;
      let edge: ReactNode = null;
      if (parent) {
        const toRight = m.x > parent.x;
        const sx = toRight ? parent.x + parent.w : parent.x;
        const sy = parent.y + parent.h / 2;
        const ex = toRight ? m.x : m.x + m.w;
        const ey = m.y + m.h / 2;
        const mx = (sx + ex) / 2;
        edge = <path d={`M${sx},${sy} C${mx},${sy} ${mx},${ey} ${ex},${ey}`} fill="none" stroke={m.color} strokeWidth={4} />;
      }
      const root = !m.parentId;
      return (
        <g key={key}>
          {edge}
          <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.h / 2} fill={root ? m.color : '#FFFFFF'} stroke={m.color} strokeWidth={4} />
          <rect x={m.x + m.w * 0.2} y={m.y + m.h / 2 - 7} width={m.w * 0.6} height={14} rx={7} fill={root ? 'rgba(255,255,255,0.8)' : 'rgba(23,22,43,0.35)'} />
        </g>
      );
    }
    case 'connector': {
      const c = el as NewElement<'connector'>;
      return (
        <path
          key={key}
          d={connectorPath(c)}
          fill="none"
          stroke={c.stroke}
          strokeWidth={Math.max(3, c.strokeWidth * 1.5)}
          strokeDasharray={c.strokeStyle === 'dashed' ? '14 10' : c.strokeStyle === 'dotted' ? '3 8' : undefined}
        />
      );
    }
    case 'image':
      return <rect key={key} x={el.x} y={el.y} width={el.w} height={el.h} rx={6} fill="#E4E3EE" />;
    case 'pen': {
      const p = el as NewElement<'pen'>;
      const pts: string[] = [];
      for (let i = 0; i < p.points.length; i += 3) pts.push(`${p.x + p.points[i]},${p.y + p.points[i + 1]}`);
      return <polyline key={key} points={pts.join(' ')} fill="none" stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinecap="round" />;
    }
    default:
      return null;
  }
}

export const TemplatePreview = memo(function TemplatePreview({ def }: { def: TemplateDef }) {
  const els = elementsFor(def) as El[];
  const b = boundsOf(els) ?? { x: 0, y: 0, w: 1, h: 1 };
  const byId = new Map(els.filter((e) => e.id).map((e) => [e.id!, e]));
  // Connectors on top of shapes, like on the board.
  const ordered = [...els.filter((e) => e.type === 'frame'), ...els.filter((e) => e.type !== 'frame')];
  const pad = Math.max(b.w, b.h) * 0.02;
  return (
    <svg
      className="fr-tpl-preview"
      viewBox={`${b.x - pad} ${b.y - pad} ${b.w + pad * 2} ${b.h + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={`${def.name} preview`}
    >
      {ordered.map((el) => draw(el, byId))}
    </svg>
  );
});
