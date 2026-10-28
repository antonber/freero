// [additive] <StaticBoardView state={bytes} />: a read-only board showing a given document state
// (a version from Host.versions), rendered by the same element components as the live board.
// It is a separate, local-only engine session (own doc, no network, role viewer, hand tool):
// panning and zooming it never touches the live board, and nobody else sees it.
// Must be rendered inside a mounted board (it reuses that board's features).
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { Host } from '../api';
import { EngineContext, useCore } from '../context';
import { createCore, type EngineCore } from '../runtime/core';
import { Canvas } from './Canvas';
import './canvas.css';

export interface StaticBoardViewProps {
  /** A full board state (`Host.versions.load`). */
  state: Uint8Array;
  /** Accessible name of the view. */
  label?: string;
}

export function StaticBoardView({ state, label = 'Board preview' }: StaticBoardViewProps) {
  const live = useCore();
  const [core, setCore] = useState<EngineCore | null>(null);

  useEffect(() => {
    const host = live.hostRef.current;
    const previewHost: Host = { ...host, board: { ...host.board, role: 'viewer' }, syncUrl: '' };
    const c = createCore(previewHost, live.bundles, { initialState: state });
    c.editor.setTool('hand');
    setCore(c);
    return () => {
      setCore(null);
      c.destroy();
    };
  }, [live, state]);

  return (
    <div className="fr-static-board" role="region" aria-label={label}>
      {core && (
        <EngineContext.Provider value={core}>
          <Canvas />
          <FitOnce core={core} />
        </EngineContext.Provider>
      )}
    </div>
  );
}

/** Fits the content once the view has a size. */
function FitOnce({ core }: { core: EngineCore }) {
  const measured = useStore(core.ui, (s) => s.viewport.width > 1 && s.viewport.height > 1);
  useEffect(() => {
    if (!measured) return;
    if (core.editor.getElements().length) core.editor.zoomToFit(undefined, { animate: false, maxZoom: 1, area: 'viewport', padding: 48 });
    else {
      const { width, height } = core.ui.getState().viewport;
      core.editor.setCamera({ x: -width / 2, y: -height / 2, zoom: 1 });
    }
  }, [core, measured]);
  return null;
}
