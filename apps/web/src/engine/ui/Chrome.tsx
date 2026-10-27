// Board chrome composition: everything around the canvas.
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
import './chrome.css';

function Dock() {
  const core = useCore();
  const dock = useDock();
  const role = useRole();
  const reg = dock ? core.registry.panelsById.get(dock) : undefined;
  if (!reg || reg.def.slot !== 'dock-right' || ROLE_RANK[role] < ROLE_RANK[reg.def.minRole ?? 'viewer']) return null;
  const { def, feature } = reg;
  return (
    <aside className="fr-dock fr-chrome-card" data-fr-chrome="" aria-label="Side panel">
      <IconButton className="fr-dock__close" icon={X} label="Close panel" size={32} onClick={() => core.editor.openDock(null)} />
      <div className="fr-dock__body" data-fr-scrollable="">
        <ScopeContext.Provider value={feature}>
          <def.Component editor={core.scoped(feature)} />
        </ScopeContext.Provider>
      </div>
    </aside>
  );
}

function ConnectionBanner() {
  const core = useCore();
  const status = useStore(core.ui, (s) => s.connection);
  const synced = useStore(core.ui, (s) => s.synced);
  if (status === 'local' || (status === 'connected' && synced)) return null;
  if (status === 'denied')
    return (
      <div className="fr-connection fr-connection--error" role="status">
        <WifiOff size={14} /> You no longer have access to this board.
      </div>
    );
  if (status === 'connecting' && !synced)
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
      <ConnectionBanner />
    </div>
  );
}

export function ScreenOverlayPanels() {
  return <PanelSlotView slot="screen-overlay" />;
}

export function WorldOverlayPanels() {
  return <PanelSlotView slot="world-overlay" />;
}
