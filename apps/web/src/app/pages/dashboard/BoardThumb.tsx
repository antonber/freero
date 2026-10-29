import { memo, useState } from 'react';
import type { BoardSummary } from '@freero/shared';
import { placeholderFor } from '../../lib/placeholder';

/** Board thumbnail, or a deterministic illustrated placeholder seeded by the board id; a doc's page for a doc. */
export const BoardThumb = memo(function BoardThumb({ board }: { board: Pick<BoardSummary, 'id' | 'thumbnail'> & { kind?: BoardSummary['kind'] } }) {
  const [broken, setBroken] = useState(false);
  if (board.kind === 'doc') return <DocPage id={board.id} />;
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

/** A doc's card (KAI-162): a sheet with a heading and lines of text, lengths seeded by the doc id. */
function DocPage({ id }: { id: string }) {
  const spec = placeholderFor(id);
  let seed = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const next = () => ((seed = (seed * 1103515245 + 12345) >>> 0) % 1000) / 1000;
  const lines = Array.from({ length: 6 }, (_, i) => ({ y: 92 + i * 15, w: 120 + next() * 70 }));
  return (
    <svg className="fr-thumb fr-thumb--doc" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <rect width="320" height="200" fill={spec.bg} />
      <rect x="86" y="30" width="148" height="190" rx="6" fill="#17162b" opacity="0.06" />
      <rect x="82" y="24" width="156" height="190" rx="6" fill="#fff" />
      <rect x="100" y="46" width="92" height="10" rx="5" fill={spec.linkColor} opacity="0.85" />
      <rect x="100" y="66" width="40" height="5" rx="2.5" fill="#17162b" opacity="0.14" />
      {lines.map((l, i) => (
        <rect key={i} x="100" y={l.y} width={Math.min(l.w, 120)} height="5" rx="2.5" fill="#17162b" opacity="0.16" />
      ))}
    </svg>
  );
}
