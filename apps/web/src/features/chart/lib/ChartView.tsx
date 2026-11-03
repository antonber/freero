// Draws a chart as SVG from its data (Freero's own drawing). Text, axes and grid lines use the
// board's default inks (`canvasInk`), so on a dark canvas they turn light while exports keep the
// authored colours; series use the chart palette (@freero/shared CHART_COLORS).
import type { ChartData, ChartKind } from '@freero/shared';
import { canvasInk } from '@engine';

const INK = '#17162B';
const MUTED = '#4B4A63';
const FONT = "'Inter', system-ui, sans-serif";

/** Up to ~5 round tick values covering [lo, hi]. */
export function niceTicks(lo: number, hi: number): number[] {
  if (lo === hi) hi = lo + 1;
  const raw = (hi - lo) / 5;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  if (out[out.length - 1] < hi) out.push(out[out.length - 1] + step);
  return out;
}

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `${+(n / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (a >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return `${+n.toFixed(2)}`;
};

const clipText = (s: string, max: number) => (s.length > max ? `${s.slice(0, Math.max(1, max - 1))}…` : s);

function Legend({ items, x, y, w }: { items: Array<{ name: string; color: string }>; x: number; y: number; w: number }) {
  // Laid out left to right, wrapping; each entry a swatch and its name.
  let cx = 0;
  let cy = 0;
  const placed = items.map((it) => {
    const label = clipText(it.name, 24);
    const width = 18 + label.length * 6.6 + 14;
    if (cx > 0 && cx + width > w) {
      cx = 0;
      cy += 18;
    }
    const at = { x: cx, y: cy, label, color: it.color };
    cx += width;
    return at;
  });
  const total = placed.length ? Math.max(...placed.map((p) => p.x + 18 + p.label.length * 6.6)) : 0;
  const ox = x + Math.max(0, (w - total) / 2);
  return (
    <g fontSize="11" fill="currentColor">
      {placed.map((p, i) => (
        <g key={i} transform={`translate(${ox + p.x} ${y + p.y})`}>
          <rect width="11" height="11" rx="3" fill={p.color} />
          <text x="17" y="9.5">
            {p.label}
          </text>
        </g>
      ))}
    </g>
  );
}

export const legendRows = (n: number, w: number) => Math.max(1, Math.ceil((n * 90) / Math.max(120, w)));

export function ChartView({ kind, title, data, w, h, legend }: { kind: ChartKind; title: string; data: ChartData; w: number; h: number; legend?: boolean }) {
  const pad = 14;
  const titleH = title ? 26 : 0;
  const showLegend = legend ?? (kind === 'pie' || data.series.length > 1);
  const legendItems = kind === 'pie' ? data.labels.map((l, i) => ({ name: l || `Slice ${i + 1}`, color: data.series[0] ? sliceColor(i) : '#ccc' })) : data.series;
  const legendH = showLegend && legendItems.length ? legendRows(legendItems.length, w - 2 * pad) * 18 + 6 : 0;
  const box = { x: pad, y: pad + titleH, w: Math.max(10, w - 2 * pad), h: Math.max(10, h - 2 * pad - titleH - legendH) };
  return (
    <svg className="fr-chart__svg" width={w} height={h} viewBox={`0 0 ${w} ${h}`} fontFamily={FONT} style={{ color: canvasInk(INK) }} role="img" aria-label={title || 'Chart'}>
      {title && (
        <text x={w / 2} y={pad + 15} textAnchor="middle" fontSize="15" fontWeight="600" fill="currentColor">
          {clipText(title, Math.max(8, Math.floor(w / 8.5)))}
        </text>
      )}
      {kind === 'pie' ? <Pie data={data} box={box} /> : <Cartesian kind={kind} data={data} box={box} />}
      {legendH > 0 && <Legend items={legendItems} x={pad} y={h - pad - legendH + 6} w={w - 2 * pad} />}
    </svg>
  );
}

/** Pie slices take the palette in category order (a pie has one series). */
const PIE = ['#5B3FF0', '#1FBF96', '#F5A524', '#F0645A', '#3B8BF0', '#E2559B', '#8A6A00', '#4B4A63', '#A794FF', '#7FD9C0'];
const sliceColor = (i: number) => PIE[i % PIE.length];

function Pie({ data, box }: { data: ChartData; box: { x: number; y: number; w: number; h: number } }) {
  const values = (data.series[0]?.values ?? []).map((v) => (v && v > 0 ? v : 0));
  const total = values.reduce((a, b) => a + b, 0);
  const r = Math.max(4, Math.min(box.w, box.h) / 2 - 2);
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  if (!total) return <circle cx={cx} cy={cy} r={r} fill="none" stroke={canvasInk(MUTED)} strokeOpacity="0.4" strokeDasharray="4 4" />;
  let a = -Math.PI / 2;
  return (
    <g>
      {values.map((v, i) => {
        if (!v) return null;
        const da = (v / total) * Math.PI * 2;
        const a0 = a;
        a += da;
        const mid = a0 + da / 2;
        const pct = Math.round((v / total) * 100);
        const label = pct >= 6 && r > 40 ? (
          <text x={cx + Math.cos(mid) * r * 0.64} y={cy + Math.sin(mid) * r * 0.64 + 4} textAnchor="middle" fontSize="12" fontWeight="600" fill="#fff">
            {pct}%
          </text>
        ) : null;
        if (da >= Math.PI * 2 - 1e-6)
          return (
            <g key={i}>
              <circle cx={cx} cy={cy} r={r} fill={sliceColor(i)} />
              {label}
            </g>
          );
        const p0 = [cx + Math.cos(a0) * r, cy + Math.sin(a0) * r];
        const p1 = [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
        return (
          <g key={i}>
            <path d={`M${cx} ${cy}L${p0[0]} ${p0[1]}A${r} ${r} 0 ${da > Math.PI ? 1 : 0} 1 ${p1[0]} ${p1[1]}Z`} fill={sliceColor(i)} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
            {label}
          </g>
        );
      })}
    </g>
  );
}

function Cartesian({ kind, data, box }: { kind: Exclude<ChartKind, 'pie'>; data: ChartData; box: { x: number; y: number; w: number; h: number } }) {
  const n = data.labels.length;
  const stacked = kind === 'stackedBar';
  let lo = 0;
  let hi = 0;
  for (let i = 0; i < n; i++) {
    if (stacked) {
      let pos = 0;
      let neg = 0;
      for (const s of data.series) {
        const v = s.values[i] ?? 0;
        if (v >= 0) pos += v;
        else neg += v;
      }
      hi = Math.max(hi, pos);
      lo = Math.min(lo, neg);
    } else
      for (const s of data.series) {
        const v = s.values[i];
        if (v === null || v === undefined) continue;
        hi = Math.max(hi, v);
        lo = Math.min(lo, v);
      }
  }
  const ticks = niceTicks(lo, hi);
  const t0 = ticks[0];
  const t1 = ticks[ticks.length - 1];
  const axisW = Math.max(...ticks.map((t) => fmt(t).length)) * 6.6 + 8;
  const labelH = 18;
  const plot = { x: box.x + axisW, y: box.y + 6, w: Math.max(4, box.w - axisW), h: Math.max(4, box.h - labelH - 6) };
  const y = (v: number) => plot.y + plot.h - ((v - t0) / (t1 - t0 || 1)) * plot.h;
  const band = plot.w / Math.max(1, n);
  const cx = (i: number) => plot.x + band * (i + 0.5);
  const maxChars = Math.max(2, Math.floor(band / 6.6));
  const grid = canvasInk(MUTED);
  return (
    <g>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={plot.x} x2={plot.x + plot.w} y1={y(t)} y2={y(t)} stroke={grid} strokeOpacity={t === 0 ? 0.7 : 0.18} strokeWidth="1" />
          <text x={plot.x - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.75">
            {fmt(t)}
          </text>
        </g>
      ))}
      {data.labels.map((l, i) => (
        <text key={i} x={cx(i)} y={plot.y + plot.h + 14} textAnchor="middle" fontSize="11" fill="currentColor" fillOpacity="0.85">
          {clipText(l, maxChars)}
        </text>
      ))}
      {kind === 'bar' || kind === 'stackedBar' ? <Bars data={data} stacked={stacked} band={band} cx={cx} y={y} /> : <Lines data={data} area={kind === 'area'} cx={cx} y={y} base={y(Math.max(t0, Math.min(0, t1)))} />}
    </g>
  );
}

function Bars({ data, stacked, band, cx, y }: { data: ChartData; stacked: boolean; band: number; cx(i: number): number; y(v: number): number }) {
  const groupW = band * 0.72;
  const k = data.series.length || 1;
  const barW = stacked ? groupW : groupW / k;
  const r = Math.min(4, barW / 4);
  const out: JSX.Element[] = [];
  data.labels.forEach((_, i) => {
    let pos = 0;
    let neg = 0;
    data.series.forEach((s, j) => {
      const v = s.values[i];
      if (v === null || v === undefined || v === 0) return;
      let from: number;
      let to: number;
      if (stacked) {
        from = v >= 0 ? pos : neg;
        to = from + v;
        if (v >= 0) pos = to;
        else neg = to;
      } else {
        from = 0;
        to = v;
      }
      const x = stacked ? cx(i) - groupW / 2 : cx(i) - groupW / 2 + j * barW;
      const top = Math.min(y(from), y(to));
      const hgt = Math.max(0.5, Math.abs(y(to) - y(from)));
      out.push(<rect key={`${i}:${j}`} x={x + (stacked ? 0 : 1)} y={top} width={Math.max(1, barW - (stacked ? 0 : 2))} height={hgt} rx={stacked ? 0 : r} fill={s.color} />);
    });
  });
  return <g>{out}</g>;
}

function Lines({ data, area, cx, y, base }: { data: ChartData; area: boolean; cx(i: number): number; y(v: number): number; base: number }) {
  return (
    <g>
      {data.series.map((s) => {
        // A missing value breaks the line into runs.
        const runs: Array<Array<[number, number]>> = [];
        let run: Array<[number, number]> = [];
        s.values.forEach((v, i) => {
          if (v === null || v === undefined) {
            if (run.length) runs.push(run);
            run = [];
          } else run.push([cx(i), y(v)]);
        });
        if (run.length) runs.push(run);
        return (
          <g key={s.id}>
            {area &&
              runs.map((r, k) => (
                <path key={`a${k}`} d={`M${r[0][0]} ${base}${r.map(([px, py]) => `L${px} ${py}`).join('')}L${r[r.length - 1][0]} ${base}Z`} fill={s.color} fillOpacity="0.22" />
              ))}
            {runs.map((r, k) => (
              <path key={`l${k}`} d={r.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('')} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            ))}
            {runs.flat().map(([px, py], k) => (
              <circle key={`p${k}`} cx={px} cy={py} r="3.5" fill={s.color} stroke="#fff" strokeWidth="1.5" />
            ))}
          </g>
        );
      })}
    </g>
  );
}
