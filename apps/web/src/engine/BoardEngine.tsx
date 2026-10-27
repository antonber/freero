// Composition root of the engine: <BoardEngine host={host} features={bundles} />.
// Creates one EngineCore per board session (store, UI state, registry, editor), mounts the
// canvas and chrome, and tears everything down on unmount (saving a last thumbnail).
import { useEffect, useRef, useState } from 'react';
import type { FeatureBundle, Host } from './api';
import { EngineContext } from './context';
import { createCore, type EngineCore } from './runtime/core';
import { Canvas } from './canvas/Canvas';
import { ScreenOverlays } from './overlay/Overlays';
import { Chrome, DialogPanels, ScreenOverlayPanels, WorldOverlayPanels } from './ui/Chrome';
import { installKeyboard } from './interaction/keyboard';
import { createExportRenderer, startThumbnails } from './editor/export';
import './board.css';

export interface BoardEngineProps {
  host: Host;
  features: FeatureBundle[];
}

export function BoardEngine({ host, features }: BoardEngineProps) {
  const [core, setCore] = useState<EngineCore | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    let c: EngineCore;
    try {
      c = createCore(hostRef.current, features, { persistLocal: !hostRef.current.syncUrl });
    } catch (e) {
      setError(e as Error);
      return;
    }
    c.renderExport = createExportRenderer(c);
    const thumbs = startThumbnails(c);
    setCore(c);
    return () => {
      setCore(null);
      void thumbs.stop().finally(() => c.destroy());
    };
  }, [host.board.id, host.syncUrl, features]);

  const publishedUser = useRef(host.user);
  useEffect(() => {
    if (!core) return;
    core.hostRef.current = host;
    // [QA collab] Profile changed (name, color, avatar) while on the board: collaborators' cursors
    // and avatars follow without a reload.
    const u = host.user;
    const prev = publishedUser.current;
    publishedUser.current = u;
    if (prev.name !== u.name || prev.color !== u.color || prev.avatarUrl !== u.avatarUrl)
      core.store.setPresence({ user: { id: u.id, name: u.name, color: u.color, avatarUrl: u.avatarUrl } });
  }, [core, host]);

  if (error)
    return (
      <div className="fr-board fr-board--error" role="alert">
        <h2>This board couldn't start</h2>
        <pre>{error.message}</pre>
      </div>
    );
  if (!core) return <div className="fr-board" />;
  return (
    <EngineContext.Provider value={core}>
      <BoardView core={core} />
    </EngineContext.Provider>
  );
}

function BoardView({ core }: { core: EngineCore }) {
  useEffect(() => installKeyboard(core), [core]);
  useInitialView(core);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __freero?: unknown };
    w.__freero = { editor: core.editor, core };
    return () => {
      if ((w.__freero as { core?: unknown } | undefined)?.core === core) delete w.__freero;
    };
  }, [core]);

  return (
    <div className="fr-board">
      <Canvas worldOverlay={<WorldOverlayPanels />} screenOverlay={<><ScreenOverlays /><ScreenOverlayPanels /></>} />
      <Chrome />
      <DialogPanels />
    </div>
  );
}

/**
 * Once the viewport is measured and the doc is synced: honor ?el=<id> (select + zoom to it) and
 * ?dock=<panelId>, otherwise fit the content (or center the origin on an empty board).
 */
function useInitialView(core: EngineCore) {
  useEffect(() => {
    let done = false;
    const params = new URLSearchParams(window.location.search);
    const dock = params.get('dock');
    if (dock && core.registry.panelsById.get(dock)?.def.slot === 'dock-right') core.editor.openDock(dock);
    const tryInit = () => {
      if (done) return;
      const s = core.ui.getState();
      if (s.viewport.width <= 1 || !s.synced) return;
      done = true;
      const editor = core.editor;
      const el = params.get('el');
      if (el && editor.getElement(el)) {
        editor.select([el]);
        editor.zoomToFit([el], { animate: false, maxZoom: 1, padding: 160 });
      } else if (editor.getElements().length) {
        editor.zoomToFit(undefined, { animate: false, maxZoom: 1 });
      } else {
        editor.setCamera({ x: -s.viewport.width / 2, y: -s.viewport.height / 2, zoom: 1 });
      }
    };
    tryInit();
    const off = core.ui.subscribe(tryInit);
    return off;
  }, [core]);
}
