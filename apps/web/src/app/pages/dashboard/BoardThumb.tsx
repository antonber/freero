import { memo, useState } from 'react';
import type { BoardSummary } from '@freero/shared';
import { placeholderFor } from '../../lib/placeholder';

/** Board thumbnail, or a deterministic illustrated placeholder seeded by the board id. */
export const BoardThumb = memo(function BoardThumb({ board }: { board: Pick<BoardSummary, 'id' | 'thumbnail'> }) {
  const [broken, setBroken] = useState(false);
  if (board.thumbnail && !broken) {
    return <img className="fr-thumb fr-thumb--img" src={board.thumbnail} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />;
  }
  return <Placeholder id={board.id} />;
});

function Placeholder({ id }: { id: string }) {
  const spec = placeholderFor(id);
  const pid = `fr-dots-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg className="fr-thumb" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <defs>
        <pattern id={pid} width="16" height="16" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.1" fill={spec.dot} />
        </pattern>
      </defs>
      <rect width="320" height="200" fill={spec.bg} />
      <rect width="320" height="200" fill={`url(#${pid})`} />
      <path d={spec.link} fill="none" stroke={spec.linkColor} strokeOpacity="0.55" strokeWidth="2" strokeLinecap="round" strokeDasharray="5 5" />
      {spec.shapes.map((s, i) => {
        const t = `rotate(${s.rotate.toFixed(2)} ${(s.x + s.w / 2).toFixed(1)} ${(s.y + s.h / 2).toFixed(1)})`;
        if (s.kind === 'sticky') {
          return (
            <g key={i} transform={t}>
              <rect x={s.x + 1} y={s.y + 3} width={s.w} height={s.h} rx="3" fill="#17162b" opacity="0.07" />
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx="3" fill={s.color} />
              <rect x={s.x + 8} y={s.y + 12} width={s.w - 16} height="4" rx="2" fill="#17162b" opacity="0.18" />
              <rect x={s.x + 8} y={s.y + 21} width={(s.w - 16) * 0.65} height="4" rx="2" fill="#17162b" opacity="0.18" />
            </g>
          );
        }
        if (s.kind === 'circle') {
          return <ellipse key={i} cx={s.x + s.w / 2} cy={s.y + s.h / 2} rx={s.w / 2} ry={s.h / 2} fill="#fff" stroke={s.color} strokeWidth="3" />;
        }
        return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.h / 2} fill={s.color} opacity="0.9" />;
      })}
    </svg>
  );
}
