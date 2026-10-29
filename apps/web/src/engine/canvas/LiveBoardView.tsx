// [additive, KAI-152] <LiveBoardView boardId frameId? />: a LIVE board (or one of its frames) shown
// inside something else — a doc. It is a separate engine session with its own Yjs doc and its own
// socket to THAT board, so the server admits it with the reader's access to the embedded board
// (never the host's), sends it what that reader may see (no layers they may not read), and it
// renders with the board's own element components. Read-only and non-interactive: the host shows
// it and links to the board; edits happen on the board, so undo here and there never mix.
import { useContext, useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { FeatureBundle, Host } from '../api';
import { EngineContext } from '../context';
import { useElement } from '../hooks';
import { createCore, type EngineCore } from '../runtime/core';
import { Canvas } from './Canvas';
import './canvas.css';

/** What the view knows about the embedded board. */
export type LiveBoardStatus = 'connecting' | 'ready' | 'denied' | 'removed' | 'missing';

export interface LiveBoardViewProps {
  boardId: string;
  /** Fit this frame (an item on the board); absent: the whole board. */
  frameId?: string | null;
  /**
   * Services and identity to connect with (`syncUrl` = the boards socket prefix). Default: the
   * board this view is shown in (it must then be rendered inside a mounted board).
   */
  host?: Host;
  /** Element definitions to draw with. Default: the surrounding board's. */
  features?: FeatureBundle[];
  onStatus?(status: LiveBoardStatus): void;
  label?: string;
}

export function LiveBoardView({ boardId, frameId, host, features, onStatus, label = 'Live board' }: LiveBoardViewProps) {
  const outer = useContext(EngineContext);
  const [core, setCore] = useState<EngineCore | null>(null);
  const baseHost = host ?? outer?.hostRef.current ?? null;
  const bundles = features ?? outer?.bundles ?? null;

  useEffect(() => {
    if (!baseHost || !bundles) return;
    const embedHost: Host = { ...baseHost, board: { id: boardId, title: '', role: 'viewer', canExport: false, embedded: true } };
    const c = createCore(embedHost, bundles);
    c.editor.setTool('hand');
    setCore(c);
    return () => {
      setCore(null);
      c.destroy();
    };
    // The host object changes identity on unrelated updates; the board and its services don't.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, baseHost?.syncUrl, bundles]);

  return (
    <div className="fr-live-board" role="img" aria-label={label}>
      {core && (
        <EngineContext.Provider value={core}>
          <Canvas />
          <Fit core={core} frameId={frameId ?? null} onStatus={onStatus} />
        </EngineContext.Provider>
      )}
    </div>
  );
}

/** Fits the frame (or the board) whenever the view is measured, synced or resized; reports status. */
function Fit({ core, frameId, onStatus }: { core: EngineCore; frameId: string | null; onStatus?: (s: LiveBoardStatus) => void }) {
  const width = useStore(core.ui, (s) => s.viewport.width);
  const height = useStore(core.ui, (s) => s.viewport.height);
  const synced = useStore(core.ui, (s) => s.synced);
  const connection = useStore(core.ui, (s) => s.connection);
  const frame = useElement(frameId);
  const geometry = frame ? `${frame.x},${frame.y},${frame.w},${frame.h}` : '';

  useEffect(() => {
    const status: LiveBoardStatus =
      connection === 'denied' ? 'denied' : connection === 'removed' ? 'removed' : !synced ? 'connecting' : frameId && !core.editor.getElement(frameId) ? 'missing' : 'ready';
    onStatus?.(status);
  }, [connection, synced, frameId, geometry, core, onStatus]);

  useEffect(() => {
    if (width <= 1 || height <= 1 || !synced) return;
    const ids = frameId && core.editor.getElement(frameId) ? [frameId] : undefined;
    if (ids || core.editor.getElements().length) core.editor.zoomToFit(ids, { animate: false, maxZoom: 1.5, area: 'viewport', padding: 12 });
    else core.editor.setCamera({ x: -width / 2, y: -height / 2, zoom: 1 });
  }, [core, width, height, synced, frameId, geometry]);
  return null;
}
