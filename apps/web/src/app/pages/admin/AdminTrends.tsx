// Usage over time (#65): the daily rollups of the last 90 days as small multiples — one measure per
// chart, one axis each — with a hover readout, a table view and a CSV download. Counts only.
import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import type { UsageDay, WorkspaceSummary } from '@freero/shared';
import { Spinner } from '@ui';
import { api } from '../../api/client';

const W = 300;
const H = 84;
const PAD = { top: 8, right: 6, bottom: 18, left: 30 };

type Measure = { id: string; label: string; form: 'line' | 'bars'; value: (d: UsageDay) => number };
const MEASURES: Measure[] = [
  { id: 'active', label: 'Active people, last 7 days', form: 'line', value: (d) => d.activeUsers7d },
  { id: 'boards', label: 'Boards and docs created', form: 'bars', value: (d) => d.boardsCreated + d.docsCreated },
  { id: 'guests', label: 'Guests', form: 'line', value: (d) => d.guests },
  { id: 'api', label: 'API and MCP calls', form: 'bars', value: (d) => Object.values(d.apiCalls).reduce((a, b) => a + b, 0) },
];

const niceMax = (v: number) => {
  if (v <= 4) return Math.max(1, v);
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
};
const shortDay = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function Chart({ m, days }: { m: Measure; days: UsageDay[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const values = days.map(m.value);
  const max = niceMax(Math.max(0, ...values));
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const step = days.length > 1 ? iw / (days.length - 1) : 0;
  const x = (i: number) => PAD.left + (m.form === 'bars' ? (iw / days.length) * (i + 0.5) : days.length > 1 ? step * i : iw / 2);
  const y = (v: number) => PAD.top + ih - (v / max) * ih;
  const slot = iw / Math.max(1, days.length);
  const barW = Math.max(1, Math.min(12, slot - 2));
  const shown = hover ?? values.length - 1;
  return (
    <figure className="fr-admin-trend">
      <figcaption className="fr-admin-trend__head">
        <span className="fr-admin-trend__label">{m.label}</span>
        <span className="fr-admin-trend__value">
          {values[shown] ?? 0}
          <span className="fr-admin__muted"> · {days[shown] ? shortDay(days[shown].day) : ''}</span>
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="fr-admin-trend__svg" role="img" aria-label={`${m.label}, ${days.length} days`} onMouseLeave={() => setHover(null)}>
        {[0, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="fr-admin-trend__grid" />
            <text x={PAD.left - 6} y={y(t) + 3} textAnchor="end" className="fr-admin-trend__tick">
              {t}
            </text>
          </g>
        ))}
        {days.length ? (
          <>
            <text x={PAD.left} y={H - 4} className="fr-admin-trend__tick">
              {shortDay(days[0].day)}
            </text>
            {days.length > 1 ? (
              <text x={W - PAD.right} y={H - 4} textAnchor="end" className="fr-admin-trend__tick">
                {shortDay(days[days.length - 1].day)}
              </text>
            ) : null}
          </>
        ) : null}
        {m.form === 'bars' ? (
          values.map((v, i) =>
            v > 0 ? (
              <path
                key={i}
                className="fr-admin-trend__bar"
                d={(() => {
                  const h = Math.max(1, y(0) - y(v));
                  const r = Math.min(2, barW / 2, h);
                  const l = x(i) - barW / 2;
                  const top = y(0) - h;
                  return `M${l},${y(0)}V${top + r}Q${l},${top} ${l + r},${top}H${l + barW - r}Q${l + barW},${top} ${l + barW},${top + r}V${y(0)}Z`;
                })()}
              />
            ) : null,
          )
        ) : (
          <>
            <polyline className="fr-admin-trend__line" points={values.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
            {/* The newest point (and the only one, on the first day). */}
            {values.length ? <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r={4} className="fr-admin-trend__dot" /> : null}
          </>
        )}
        {hover !== null ? (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + ih} className="fr-admin-trend__cross" />
            {m.form === 'line' ? <circle cx={x(hover)} cy={y(values[hover])} r={4} className="fr-admin-trend__dot" /> : null}
          </>
        ) : null}
        {days.map((d, i) => (
          <rect key={d.day} x={x(i) - slot / 2} y={0} width={slot} height={H} fill="transparent" onMouseEnter={() => setHover(i)}>
            <title>{`${shortDay(d.day)}: ${values[i]}`}</title>
          </rect>
        ))}
      </svg>
    </figure>
  );
}

export function AdminTrends({ workspace }: { workspace: WorkspaceSummary }) {
  const [days, setDays] = useState<UsageDay[] | null>(null);
  useEffect(() => {
    let live = true;
    api.usageHistory(workspace.id, 90).then(
      (r) => live && setDays(r.days),
      () => live && setDays([]),
    );
    return () => {
      live = false;
    };
  }, [workspace.id]);
  const recent = useMemo(() => (days ?? []).slice(-14).reverse(), [days]);

  if (!days) return <Spinner />;
  return (
    <section aria-labelledby="admin-trends-title">
      <div className="fr-admin__head">
        <h2 id="admin-trends-title" className="fr-admin__subtitle">
          Over the last 90 days
        </h2>
        <a className="fr-admin-trends__csv" href={api.usageHistoryCsvUrl(workspace.id, 90)} download>
          <Download size={14} aria-hidden /> Download CSV
        </a>
      </div>
      {days.length === 0 ? (
        <p className="fr-admin__muted">Freero records the workspace’s usage once a day. The first point appears within the hour.</p>
      ) : (
        <>
          <div className="fr-admin-trends">
            {MEASURES.map((m) => (
              <Chart key={m.id} m={m} days={days} />
            ))}
          </div>
          <details className="fr-admin-trends__table">
            <summary>Show as a table (last 14 days)</summary>
            <div className="fr-admin-table-wrap">
              <table className="fr-admin-table">
                <thead>
                  <tr>
                    <th scope="col">Day</th>
                    {MEASURES.map((m) => (
                      <th key={m.id} scope="col">
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recent.map((d) => (
                    <tr key={d.day}>
                      <td>{shortDay(d.day)}</td>
                      {MEASURES.map((m) => (
                        <td key={m.id}>{m.value(d)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
