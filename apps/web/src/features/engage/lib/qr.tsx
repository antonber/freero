// QR codes of answer links (#40), encoded by the pinned `qrcode` package (MIT) and drawn here as
// one SVG path: crisp at any zoom and in exports, no canvas, no image request.
import { memo, useMemo } from 'react';
import { create } from 'qrcode';

/** The dark modules of `text` as one path (1 unit per module) and the symbol's size. */
export function qrPath(text: string): { d: string; size: number } {
  const { modules } = create(text, { errorCorrectionLevel: 'M' });
  const n = modules.size;
  let d = '';
  for (let y = 0; y < n; y++) {
    // Runs of dark modules on a row become one rectangle each.
    for (let x = 0; x < n; ) {
      if (!modules.get(y, x)) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < n && modules.get(y, end)) end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  }
  return { d, size: n };
}

/** A QR code of `text` with the standard quiet zone, filling its box. */
export const QrCode = memo(function QrCode({ text, label, className }: { text: string; label: string; className?: string }) {
  const { d, size } = useMemo(() => qrPath(text), [text]);
  const quiet = 4;
  const box = size + quiet * 2;
  return (
    <svg className={className} viewBox={`${-quiet} ${-quiet} ${box} ${box}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect x={-quiet} y={-quiet} width={box} height={box} fill="#fff" />
      <path d={d} fill="#17162B" />
    </svg>
  );
});
