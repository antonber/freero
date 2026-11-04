// Board chrome composition: everything around the canvas.
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { WifiOff, X } from 'lucide-react';
import { IconButton, Spinner } from '@ui';
import { ScopeContext, useCore } from '../context';
import { useBottomDock, useDock, useRole } from '../hooks';
import { ROLE_RANK } from '../runtime/core';
import { Toolbar } from './Toolbar';
import { TopLeft, TopRight } from './TopBar';
import { BottomLeft, BottomRight } from './Navigation';
import { FormatToolbar } from './FormatToolbar';
import { ContextMenu } from './ContextMenu';
import { PanelSlotView } from './PanelSlot';
import { DockHeaderContext } from './DockHeader';
import { t } from '../messages';
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
    <aside className="fr-dock fr-chrome-card" data-fr-chrome="" data-fr-occludes="dock" data-fr-region="dock" aria-label={t('sidePanel')}>
      <div className={`fr-dock__head${scrolled ? ' is-scrolled' : ''}`}>
        <div className="fr-dock__headslot" ref={setHeadSlot} />
        <IconButton className="fr-dock__close" icon={X} label={t('closePanel')} size={32} onClick={() => core.editor.openDock(null)} />
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

/**
 * [additive, #52] The bottom strip: the open 'dock-bottom' panel (the slide filmstrip), under the
 * canvas. The panel draws its own controls (and its close button); the strip is marked as occluding
 * so fits and placement leave it out, and the bottom corners' controls sit above it.
 */
function BottomDock() {
  const core = useCore();
  const id = useBottomDock();
  const role = useRole();
  const reg = id ? core.registry.panelsById.get(id) : undefined;
  if (!reg || reg.def.slot !== 'dock-bottom' || ROLE_RANK[role] < ROLE_RANK[reg.def.minRole ?? 'viewer']) return null;
  const { def, feature } = reg;
  return (
    <section className="fr-bottomdock fr-chrome-card" data-fr-chrome="" data-fr-occludes="bottomdock" data-fr-region="bottomdock" aria-label={t('bottomPanel')}>
      <ScopeContext.Provider value={feature}>
        <def.Component editor={core.scoped(feature)} />
      </ScopeContext.Provider>
    </section>
  );
}

/** The browser's own word on the network (DevTools' offline switch, airplane mode). */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

function ConnectionBanner() {
  const core = useCore();
  const status = useStore(core.ui, (s) => s.connection);
  const synced = useStore(core.ui, (s) => s.synced);
  const restored = useStore(core.ui, (s) => s.restored);
  const online = useOnline();
  // [QA collab] After a drop the provider reports "connecting" + unsynced again: that is a
  // reconnect (edits are kept), not the first connect.
  const wasSynced = useRef(false);
  if (synced) wasSynced.current = true;
  if (status === 'local' || (status === 'connected' && synced)) return null;
  if (status === 'removed')
    return (
      <div className="fr-connection fr-connection--error" role="status">
        <WifiOff size={14} />{' '}{t('thisBoardWasRemovedBy')}</div>
    );
  if (status === 'denied')
    return (
      <div className="fr-connection fr-connection--error" role="status">
        <WifiOff size={14} />{' '}{t('youNoLongerHaveAccess')}</div>
    );
  // #178: offline. With a copy on this device, edits survive a reload; without one, only this tab holds them.
  if (!online || (restored && !wasSynced.current && status === 'disconnected'))
    return (
      <div className="fr-connection fr-connection--warn fr-connection--offline" role="status">
        <WifiOff size={14} />{' '}{core.hostRef.current.offline ? t('youReOfflineChangesAreKeptOnDevice') : t('youReOfflineKeepThisTabOpen')}</div>
    );
  if (status === 'connecting' && !synced && !wasSynced.current)
    return (
      <div className="fr-connection" role="status">
        <Spinner size={13} />{' '}{t('connecting')}</div>
    );
  return (
    <div className="fr-connection fr-connection--warn" role="status">
      <Spinner size={13} />{' '}{t('reconnectingYourChangesAreKept')}</div>
  );
}

export function Chrome() {
  const core = useCore();
  const hidden = useStore(core.ui, (s) => s.chromeHidden);
  const bottom = useStore(core.ui, (s) => !!s.bottomDock && core.registry.panelsById.get(s.bottomDock)?.def.slot === 'dock-bottom');
  if (hidden)
    return (
      <div className="fr-chrome">
        <TopCenter besideDock={false} />
        <ConnectionBanner />
      </div>
    );
  return (
    <div className={`fr-chrome${bottom ? ' fr-chrome--bottomdock' : ''}`}>
      <TopLeft />
      <TopRight />
      <Toolbar />
      <BottomLeft />
      <BottomRight />
      <FormatToolbar />
      <ContextMenu />
      <Dock />
      <BottomDock />
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
