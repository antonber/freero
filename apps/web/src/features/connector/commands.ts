import type { CapStyle, ConnectorRouting } from '@freero/shared';
import { defineCommands, type Point } from '@engine';
import { findTarget } from './lib/connect';
import { buildConnector, DEFAULT_STYLE, endpoint } from './lib/model';

import { t } from './messages';
const CAPS: readonly CapStyle[] = ['none', 'arrow'];
const ROUTINGS: readonly ConnectorRouting[] = ['straight', 'elbow', 'curved'];

const isPoint = (v: unknown): v is Point =>
  !!v && typeof v === 'object' && Number.isFinite((v as Point).x) && Number.isFinite((v as Point).y);

export default defineCommands([
  {
    // [#3] A line between two world points, made by another feature (smart drawing turns an inked
    // line or arrow into one). Each end attaches to the item it lands on, as a drop of the L tool's
    // end would, unless both land on the same item (a line drawn across one shape stays free).
    // Args: { from, to, id?, endCap?: 'none' | 'arrow', startCap?, routing?, stroke?, strokeWidth? }.
    id: 'connector.insert',
    label: t('insertLine'),
    palette: false,
    run: (editor, args) => {
      const a = (args ?? {}) as Record<string, unknown>;
      if (!isPoint(a.from) || !isPoint(a.to)) return;
      const cap = (v: unknown, fallback: CapStyle) => (CAPS.includes(v as CapStyle) ? (v as CapStyle) : fallback);
      let start = findTarget(editor, a.from, []);
      let end = findTarget(editor, a.to, []);
      if (start && end && start.id === end.id) start = end = null;
      const style = {
        ...DEFAULT_STYLE,
        routing: ROUTINGS.includes(a.routing as ConnectorRouting) ? (a.routing as ConnectorRouting) : 'straight',
        startCap: cap(a.startCap, 'none'),
        endCap: cap(a.endCap, 'none'),
        ...(typeof a.stroke === 'string' ? { stroke: a.stroke } : {}),
        ...(typeof a.strokeWidth === 'number' && a.strokeWidth > 0 ? { strokeWidth: a.strokeWidth } : {}),
      };
      const line = buildConnector(editor, endpoint(start, a.from), endpoint(end, a.to), style);
      editor.create(typeof a.id === 'string' ? { ...line, id: a.id } : line);
    },
  },
]);
