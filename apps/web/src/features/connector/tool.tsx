import { CornerDownRight, MoveUpRight, Slash, Spline } from 'lucide-react';
import type { ConnectorEndpoint, ConnectorElement, ConnectorRouting } from '@freero/shared';
import { defineTool, useToolOptions, type Editor, type Point, type ToolPointerEvent } from '@engine';
import { SegmentedControl } from '@ui';
import { DRAG_PX, findTarget, overlay, resetOverlay, snap45 } from './lib/connect';
import { dist } from './lib/geometry';
import { buildConnector, endpoint, patchConnector, styleFromOptions, TOOL_ID, type ConnectorStyle } from './lib/model';

interface Drawing {
  start: ConnectorEndpoint;
  startPoint: Point;
  downScreen: Point;
  id: string | null;
}

let drawing: Drawing | null = null;

/** The free end follows the pointer; it attaches when it's over a connectable element. */
function moveEnd(e: ToolPointerEvent, d: Drawing & { id: string }) {
  const { editor, point } = e;
  const target = findTarget(editor, point, [d.id, d.start.elementId]);
  overlay.setState({ snap: target, hover: null });
  const c = editor.getElement<ConnectorElement>(d.id);
  let at = point;
  if (!target && e.shiftKey && c?.routing === 'straight') at = snap45(c.start ?? d.startPoint, point);
  patchConnector(editor, d.id, { end: endpoint(target, at) });
}

const ROUTING_OPTIONS = [
  { value: 'straight' as const, icon: Slash, title: 'Straight' },
  { value: 'elbow' as const, icon: CornerDownRight, title: 'Elbow' },
  { value: 'curved' as const, icon: Spline, title: 'Curved' },
];

export default defineTool({
  id: TOOL_ID,
  label: 'Connection line',
  icon: MoveUpRight,
  shortcut: 'l',
  order: 40,
  placement: 'main',
  cursor: 'crosshair',

  onPointerDown({ editor, point, screen, button }) {
    if (button !== 0) return;
    const target = findTarget(editor, point, []);
    drawing = { start: endpoint(target, point), startPoint: point, downScreen: screen, id: null };
    overlay.setState({ hover: null, snap: target, dragging: true });
  },

  onPointerMove(e) {
    const { editor, point, screen } = e;
    if (!drawing) {
      // Hover: show the anchor dots of the connectable element under the pointer.
      const target = findTarget(editor, point, []);
      const cur = overlay.getState().hover;
      if (cur?.id !== target?.id || cur?.anchor !== target?.anchor) overlay.setState({ hover: target });
      return;
    }
    if (!drawing.id) {
      if (dist(screen, drawing.downScreen) < DRAG_PX) return;
      const style = styleFromOptions(editor.getToolOptions<Partial<ConnectorStyle>>(TOOL_ID));
      drawing.id = editor.create(buildConnector(editor, drawing.start, endpoint(null, point), style)) || null;
      if (!drawing.id) return;
    }
    moveEnd(e, drawing as Drawing & { id: string });
  },

  onPointerUp({ editor }) {
    const d = drawing;
    drawing = null;
    resetOverlay();
    if (!d?.id) return;
    const c = editor.getElement<ConnectorElement>(d.id);
    if (!c) return;
    // A tiny accidental flick between two free points is not a connector.
    if (!c.start.elementId && !c.end.elementId && dist(c.start, c.end) * editor.getCamera().zoom < DRAG_PX * 2) {
      editor.remove([d.id]);
      return;
    }
    editor.select([d.id]);
    editor.setTool('select');
  },

  onCancel(editor) {
    const d = drawing;
    drawing = null;
    resetOverlay();
    if (d?.id && editor.getElement(d.id)) editor.remove([d.id]);
  },

  onDeactivate() {
    resetOverlay();
  },

  Options: ({ editor }: { editor: Editor }) => {
    const opts = useToolOptions<Partial<ConnectorStyle>>(TOOL_ID);
    return (
      <div className="fr-cx-options">
        <div className="fr-cx-options__label">Line type</div>
        <SegmentedControl<ConnectorRouting>
          size="sm"
          value={styleFromOptions(opts).routing}
          onChange={(routing) => editor.setToolOptions(TOOL_ID, { routing })}
          options={ROUTING_OPTIONS}
          aria-label="Line type"
        />
      </div>
    );
  },
});
