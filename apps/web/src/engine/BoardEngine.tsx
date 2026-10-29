// Composition root of the engine: <BoardEngine host={host} features={bundles} />.
// Creates one EngineCore per board session (store, UI state, registry, editor), mounts the
// canvas and chrome, and tears everything down on unmount (saving a last thumbnail).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FeatureBundle, Host } from './api';
import { AppChromeContext, EngineContext } from './context';
import { createCore, type EngineCore } from './runtime/core';
import { Canvas } from './canvas/Canvas';
import { ScreenOverlays } from './overlay/Overlays';
import { Chrome, DialogPanels, ScreenOverlayPanels, WorldOverlayPanels } from './ui/Chrome';
import { installKeyboard } from './interaction/keyboard';
import { LiveRegion } from './ui/LiveRegion';
import { useCompactLayout } from './ui/compact';
import { useStore } from 'zustand';
import { createExportRenderer, startThumbnails } from './editor/export';
import './board.css';

export interface BoardEngineProps {
  host: Host;
  features: FeatureBundle[];
  /**
   * [additive] App-owned control shown in the top bar next to Share (the notifications bell). It
   * renders in the app's own scope: it is not a feature and gets no Editor.
   */
  topbarAccessory?: ReactNode;
  /**
   * [additive] The app's current URL query, with a key that changes on every navigation (react
   * router's `location`). Commands with `urlParam` run when it carries their param — also when the
   * app navigates to such a link while this board is already open. Default: the page URL on load.
   */
  location?: { search: string; key: string };
  /**
   * [additive] Show this document state instead of connecting: a read-only snapshot (an
   * operator's preview of a reported board). Needs `host.syncUrl === ''` and a viewer role;
   * nothing is synced or kept in localStorage.
   */
  initialState?: Uint8Array;
}

export function BoardEngine({ host, features, topbarAccessory, location, initialState }: BoardEngineProps) {
  const [core, setCore] = useState<EngineCore | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const hostRef = useRef(host);
  hostRef.current = host;

  useEffect(() => {
    let c: EngineCore;
    try {
      c = createCore(hostRef.current, features, { persistLocal: !hostRef.current.syncUrl && !initialState, initialState });
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
  }, [host.board.id, host.syncUrl, features, initialState]);

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

  const appChrome = useMemo(() => ({ topbarAccessory }), [topbarAccessory]);

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
      <AppChromeContext.Provider value={appChrome}>
        <BoardView core={core} location={location} />
      </AppChromeContext.Provider>
    </EngineContext.Provider>
  );
}

function BoardView({ core, location }: { core: EngineCore; location?: BoardEngineProps['location'] }) {
  useEffect(() => installKeyboard(core), [core]);
  const compact = useCompactLayout();
  const phoneEditing = useStore(core.ui, (s) => s.phoneEditing);
  useInitialView(core);
  useUrlCommands(core, location);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __freero?: unknown };
    w.__freero = { editor: core.editor, core };
    return () => {
      if ((w.__freero as { core?: unknown } | undefined)?.core === core) delete w.__freero;
    };
  }, [core]);

  return (
    <div className="fr-board" data-fr-layout={compact ? (phoneEditing ? 'phone-edit' : 'phone') : undefined}>
      <Canvas worldOverlay={<WorldOverlayPanels />} screenOverlay={<><ScreenOverlays /><ScreenOverlayPanels /></>} />
      <Chrome />
      <DialogPanels />
      <LiveRegion />
    </div>
  );
}

/**
 * Once the viewport is measured and the doc is synced: honor ?item=<id> (select + zoom to it) and
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
      // ?item=<id> (Copy link to item); ?el=<id> is the older spelling, still honored.
      const el = params.get('item') ?? params.get('el');
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

/**
 * Deep links into features: once the board is measured and synced (after the initial view), runs
 * every command whose `urlParam` the URL carries, with `{ [urlParam]: value }`. Again on every
 * navigation (a new location key), so following a link to the board that is already open works.
 */
function useUrlCommands(core: EngineCore, location?: { search: string; key: string }) {
  const search = location?.search;
  const key = location?.key;
  useEffect(() => {
    const params = new URLSearchParams(search ?? window.location.search);
    const due = [...core.registry.commands.values()].flatMap(({ def }) => {
      const value = def.urlParam ? params.get(def.urlParam) : null;
      return def.urlParam && value ? [{ id: def.id, args: { [def.urlParam]: value, query: Object.fromEntries(params) } }] : [];
    });
    if (!due.length) return;
    let done = false;
    const tryRun = () => {
      if (done) return;
      const s = core.ui.getState();
      if (s.viewport.width <= 1 || !s.synced) return;
      done = true;
      for (const c of due) core.editor.runCommand(c.id, c.args);
    };
    tryRun();
    return core.ui.subscribe(tryRun);
  }, [core, search, key]);
}
