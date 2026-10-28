// Board chrome composition: everything around the canvas.
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { WifiOff, X } from 'lucide-react';
import { IconButton, Spinner } from '@ui';
import { ScopeContext, useCore } from '../context';
import { useDock, useRole } from '../hooks';
import { ROLE_RANK } from '../runtime/core';
import { Toolbar } from './Toolbar';
import { TopLeft, TopRight } from './TopBar';
import { BottomLeft, BottomRight } from './Navigation';
import { FormatToolbar } from './FormatToolbar';
import { ContextMenu } from './ContextMenu';
import { PanelSlotView } from './PanelSlot';
import { DockHeaderContext } from './DockHeader';
import './chrome.css';

function Dock() {
  const core = useCore();
  const dock = useDock();
  const role = useRole();
  const reg = dock ? core.registry.panelsById.get(dock) : undefined;
  const [headSlot, setHeadSlot] = useState<HTMLDivElement | null>(null);
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => setScrolled(false), [dock]);
  if (!reg || reg.def.slot !== 'dock-right' || ROLE_RANK[role] < ROLE_RANK[reg.def.minRole ?? 'viewer']) return null;
  const { def, feature } = reg;
  return (
    <aside className="fr-dock fr-chrome-card" data-fr-chrome="" data-fr-occludes="dock" data-fr-region="dock" aria-label="Side panel">
      <div className={`fr-dock__head${scrolled ? ' is-scrolled' : ''}`}>
        <div className="fr-dock__headslot" ref={setHeadSlot} />
        <IconButton className="fr-dock__close" icon={X} label="Close panel" size={32} onClick={() => core.editor.openDock(null)} />
      </div>
      <div className="fr-dock__body" data-fr-scrollable="" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}>
        {/* Mounted once the header strip exists, so a panel's header renders there from the start. */}
        {headSlot && (
          <DockHeaderContext.Provider value={headSlot}>
            <ScopeContext.Provider value={feature}>
              <def.Component editor={core.scoped(feature)} />
            </ScopeContext.Provider>
          </DockHeaderContext.Provider>
        )}
      </div>
    </aside>
  );
}

function ConnectionBanner() {
  const core = useCore();
  const status = useStore(core.ui, (s) => s.connection);
  const synced = useStore(core.ui, (s) => s.synced);
  // [QA collab] After a drop the provider reports "connecting" + unsynced again: that is a
  // reconnect (edits are kept), not the first connect.
  const wasSynced = useRef(false);
  if (synced) wasSynced.current = true;
  if (status === 'local' || (status === 'connected' && synced)) return null;
  if (status === 'removed')
    return (
      <div className="fr-connection fr-connection--error" role="status">
        <WifiOff size={14} /> This board was removed by Freero’s moderators while they review a report.
      </div>
    );
  if (status === 'denied')
    return (
      <div className="fr-connection fr-connection--error" role="status">
        <WifiOff size={14} /> You no longer have access to this board.
      </div>
    );
  if (status === 'connecting' && !synced && !wasSynced.current)
    return (
      <div className="fr-connection" role="status">
        <Spinner size={13} /> Connecting…
      </div>
    );
  return (
    <div className="fr-connection fr-connection--warn" role="status">
      <Spinner size={13} /> Reconnecting… your changes are kept and will sync.
    </div>
  );
}

export function Chrome() {
  const hidden = useStore(useCore().ui, (s) => s.chromeHidden);
  if (hidden)
    return (
      <div className="fr-chrome">
        <TopCenter besideDock={false} />
        <ConnectionBanner />
      </div>
    );
  return (
    <div className="fr-chrome">
      <TopLeft />
      <TopRight />
      <Toolbar />
      <BottomLeft />
      <BottomRight />
      <FormatToolbar />
      <ContextMenu />
      <Dock />
      <TopCenter besideDock />
      <ConnectionBanner />
    </div>
  );
}

/** 'top-center' panels: one column under the top bar, so session bars stack instead of overlapping. */
function TopCenter({ besideDock }: { besideDock: boolean }) {
  // An open dock takes the right side: center the column in what is left instead of under it.
  const dock = useDock();
  return <PanelSlotView slot="top-center" className={`fr-topcenter${besideDock && dock ? ' fr-topcenter--dock' : ''}`} />;
}

export function ScreenOverlayPanels() {
  return <PanelSlotView slot="screen-overlay" />;
}

export function WorldOverlayPanels() {
  return <PanelSlotView slot="world-overlay" />;
}

/**
 * The open 'dialog' panel (Editor.openPanel). Mounted beside the chrome, not in it, so commands can
 * open dialogs while the chrome is hidden (presenting).
 */
export function DialogPanels() {
  const core = useCore();
  const role = useRole();
  const dialog = useStore(core.ui, (s) => s.dialog);
  const reg = dialog ? core.registry.panelsById.get(dialog.id) : undefined;
  if (!dialog || !reg || reg.def.slot !== 'dialog' || ROLE_RANK[role] < ROLE_RANK[reg.def.minRole ?? 'viewer']) return null;
  const { def, feature } = reg;
  return (
    <ScopeContext.Provider value={feature}>
      <def.Component key={dialog.id} editor={core.scoped(feature)} props={dialog.props} />
    </ScopeContext.Provider>
  );
}
