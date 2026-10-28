// A picture of board content before it lands (AI results, "Insert from text"): the elements (and
// items that would be moved, at their new places) drawn as a small SVG from their own data. Text is
// set as React text children, never markup, so nothing in the content can inject HTML here.
import { STICKY_COLORS, richTextToPlain, type BoardElement } from '@freero/shared';
import './ElementsPreview.css';

export interface ElementsPreviewProps {
  elements: BoardElement[];
  /** Existing items shown where the result would move them. */
  moved?: BoardElement[];
  /** Accessible name (default "Preview"). */
  label?: string;
  className?: string;
}

const text = (el: BoardElement): string => {
  const e = el as { text?: string; title?: string };
  return richTextToPlain(e.text ?? '') || richTextToPlain(e.title ?? '');
};

function Box({ x, y, w, h, value, size, align = 'center', bold = false }: { x: number; y: number; w: number; h: number; value: string; size: number; align?: 'center' | 'left'; bold?: boolean }) {
  if (!value) return null;
  return (
    <foreignObject x={x} y={y} width={Math.max(1, w)} height={Math.max(1, h)}>
      <div className={`fr-elements-preview__text fr-elements-preview__text--${align}`} style={{ fontSize: size, fontWeight: bold ? 600 : 400 }}>
        {value}
      </div>
    </foreignObject>
  );
}

function draw(el: BoardElement, byId: Map<string, BoardElement>) {
  const { x, y, w, h } = el;
  switch (el.type) {
    case 'frame':
      return (
        <g key={el.id}>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#fff" stroke="var(--fr-line-strong)" strokeWidth={2} />
          <text x={x + 4} y={y - 10} fontSize={20} fill="var(--fr-ink-2)">
            {(el as { title?: string }).title ?? ''}
          </text>
        </g>
      );
    case 'sticky': {
      const color = (el as { color?: string }).color ?? 'yellow';
      return (
        <g key={el.id}>
          <rect x={x} y={y} width={w} height={h} rx={4} fill={STICKY_COLORS[color as keyof typeof STICKY_COLORS] ?? STICKY_COLORS.yellow} />
          <Box x={x + 10} y={y + 10} w={w - 20} h={h - 20} value={text(el)} size={20} />
        </g>
      );
    }
    case 'shape': {
      const s = el as BoardElement & { shape: string; fill: string; stroke: string; align?: string; fontSize?: number };
      const fill = s.fill === 'transparent' ? 'none' : s.fill;
      const stroke = s.stroke === 'transparent' ? 'none' : s.stroke;
      const outline =
        s.shape === 'ellipse' || s.shape === 'circle' ? (
          <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} stroke={stroke} strokeWidth={2} />
        ) : s.shape === 'diamond' ? (
          <polygon points={`${x + w / 2},${y} ${x + w},${y + h / 2} ${x + w / 2},${y + h} ${x},${y + h / 2}`} fill={fill} stroke={stroke} strokeWidth={2} />
        ) : (
          <rect x={x} y={y} width={w} height={h} rx={s.shape === 'rect' ? 2 : Math.min(w, h) / 4} fill={fill} stroke={stroke} strokeWidth={2} />
        );
      return (
        <g key={el.id}>
          {outline}
          {s.align === 'left' ? (
            <Box x={x + 24} y={y + 20} w={w - 48} h={h - 40} value={text(el)} size={s.fontSize ?? 15} align="left" />
          ) : (
            <Box x={x + 6} y={y + 4} w={w - 12} h={h - 8} value={text(el)} size={15} />
          )}
        </g>
      );
    }
    case 'text': {
      const t = el as BoardElement & { background?: string; fontSize?: number };
      const bg = t.background && t.background !== 'transparent' ? t.background : null;
      return (
        <g key={el.id}>
          {bg && <rect x={x} y={y} width={w} height={h} rx={6} fill={bg} />}
          <Box x={x + (bg ? 14 : 0)} y={y + (bg ? 12 : 0)} w={w - (bg ? 28 : 0)} h={h - (bg ? 24 : 0)} value={text(el)} size={t.fontSize ?? 18} align="left" bold={!bg} />
        </g>
      );
    }
    case 'mindmap': {
      const m = el as BoardElement & { parentId: string | null; color: string };
      const parent = m.parentId ? byId.get(m.parentId) : null;
      return (
        <g key={el.id}>
          <rect x={x} y={y} width={w} height={h} rx={h / 2} fill={parent ? '#fff' : m.color} stroke={m.color} strokeWidth={2} />
          <Box x={x + 8} y={y} w={w - 16} h={h} value={text(el)} size={14} />
        </g>
      );
    }
    case 'kanban': {
      const k = el as BoardElement & { colW: number; columns: Array<{ id: string; title: string; color: string }> };
      return (
        <g key={el.id}>
          <rect x={x} y={y} width={w} height={h} rx={10} fill="var(--fr-surface-2)" stroke="var(--fr-line)" strokeWidth={2} />
          <Box x={x + 14} y={y + 8} w={w - 28} h={36} value={text(el)} size={18} align="left" bold />
          {k.columns.map((c, i) => {
            const cx = x + 12 + i * (k.colW + 12);
            return (
              <g key={c.id}>
                <rect x={cx} y={y + 52} width={k.colW} height={h - 64} rx={8} fill="#fff" />
                <rect x={cx} y={y + 52} width={k.colW} height={4} fill={c.color} />
                <Box x={cx + 10} y={y + 58} w={k.colW - 20} h={32} value={richTextToPlain(c.title)} size={15} align="left" bold />
              </g>
            );
          })}
        </g>
      );
    }
    case 'card': {
      const c = el as BoardElement & { color: string };
      return (
        <g key={el.id}>
          <rect x={x} y={y} width={w} height={h} rx={8} fill="#fff" stroke="var(--fr-line)" strokeWidth={1.5} />
          <rect x={x} y={y} width={5} height={h} rx={2} fill={c.color} />
          <Box x={x + 18} y={y + 10} w={w - 30} h={h - 20} value={text(el)} size={14} align="left" bold />
        </g>
      );
    }
    case 'table': {
      const t = el as BoardElement & { rows: Array<{ id: string; h: number }>; cols: Array<{ id: string; w: number }> };
      let cy = y;
      let cx = x;
      return (
        <g key={el.id}>
          <rect x={x} y={y} width={w} height={h} fill="#fff" stroke="var(--fr-line-strong)" strokeWidth={1.5} />
          <rect x={x} y={y} width={w} height={t.rows[0]?.h ?? 0} fill="var(--fr-surface-3)" />
          {t.rows.slice(0, -1).map((r) => {
            cy += r.h;
            return <line key={r.id} x1={x} x2={x + w} y1={cy} y2={cy} stroke="var(--fr-line-strong)" />;
          })}
          {t.cols.slice(0, -1).map((c) => {
            cx += c.w;
            return <line key={c.id} x1={cx} x2={cx} y1={y} y2={y + h} stroke="var(--fr-line-strong)" />;
          })}
        </g>
      );
    }
    case 'connector': {
      const c = el as BoardElement & { start: { x: number; y: number }; end: { x: number; y: number }; endCap?: string; strokeStyle?: string };
      return (
        <g key={el.id}>
          <line
            x1={c.start.x}
            y1={c.start.y}
            x2={c.end.x}
            y2={c.end.y}
            stroke="var(--fr-ink-2)"
            strokeWidth={2}
            strokeDasharray={c.strokeStyle === 'dashed' ? '8 6' : undefined}
            markerEnd={c.endCap && c.endCap !== 'none' ? 'url(#fr-elements-preview-arrow)' : undefined}
          />
        </g>
      );
    }
    default:
      return <rect key={el.id} x={x} y={y} width={w} height={h} rx={4} fill="var(--fr-surface-3)" />;
  }
}

export function ElementsPreview({ elements, moved = [], label = 'Preview', className }: ElementsPreviewProps) {
  const all = [...elements, ...moved];
  if (!all.length) return null;
  const minX = Math.min(...all.map((e) => e.x));
  const minY = Math.min(...all.map((e) => e.y));
  const maxX = Math.max(...all.map((e) => e.x + e.w));
  const maxY = Math.max(...all.map((e) => e.y + e.h));
  const pad = Math.max(maxX - minX, maxY - minY) * 0.04 + 24;
  const byId = new Map(elements.map((e) => [e.id, e]));
  // Frames and boards below, lines below boxes (like on the board).
  const order = (e: BoardElement) => (e.type === 'frame' || e.type === 'kanban' ? 0 : e.type === 'connector' ? 1 : 2);
  const sorted = [...all].sort((a, b) => order(a) - order(b));
  return (
    <svg
      className={`fr-elements-preview${className ? ` ${className}` : ''}`}
      viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={label}
    >
      <defs>
        <marker id="fr-elements-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--fr-ink-2)" />
        </marker>
      </defs>
      {/* Mind-map branches under every topic pill. */}
      {elements.map((el) => {
        const m = el as BoardElement & { parentId?: string | null; color?: string };
        const parent = el.type === 'mindmap' && m.parentId ? byId.get(m.parentId) : null;
        return parent ? <line key={`branch-${el.id}`} x1={parent.x + parent.w / 2} y1={parent.y + parent.h / 2} x2={el.x + el.w / 2} y2={el.y + el.h / 2} stroke={m.color} strokeWidth={2} /> : null;
      })}
      {sorted.map((el) => draw(el, byId))}
    </svg>
  );
}
