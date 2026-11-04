// Top-left: logo, inline-editable title, board ⋯ menu, topbar-left panels.
// Top-right: topbar-right panels + Share.
import { useContext, useEffect, useRef, useState, type ComponentType } from 'react';
import { ArrowLeft, ChevronRight, Ellipsis, Eye, Link2, Maximize, MessageSquare, PencilLine, Share2 } from 'lucide-react';
import { Button, ColorSwatches, IconButton, Logo, Menu, Popover, SegmentedControl, Toggle, Tooltip, type MenuAction } from '@ui';
import type { BoardSettings } from '@freero/shared';
import { AppChromeContext, useCore } from '../context';
import { useRole, useSettings } from '../hooks';
import { ROLE_RANK } from '../runtime/core';
import { PanelSlotView } from './PanelSlot';
import { formatShortcut, isMac } from '../runtime/shortcuts';
import { BACKGROUNDS, GRID_SIZES, GRID_STYLES } from '../editor/boardSettings';

import { commandItem, groupCommands } from './ContextMenu';

import { t } from '../messages';
const BACKGROUND_COLORS = BACKGROUNDS.map((b) => b.color);
const BACKGROUND_NAMES: Record<string, string> = Object.fromEntries(BACKGROUNDS.map((b) => [b.color, b.name]));

function BoardTitle() {
  const core = useCore();
  const host = core.hostRef.current;
  const role = useRole();
  const canRename = ROLE_RANK[role] >= ROLE_RANK.editor;
  const [title, setTitle] = useState(host.board.title);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { boardTitle = host.board.title } = useContext(AppChromeContext);

  useEffect(() => setTitle(boardTitle), [boardTitle]);
  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);
  useEffect(() => {
    document.title = `${title || 'Untitled board'} · Freero`;
  }, [title]);
  useEffect(() => {
    const onRename = () => setEditing(true);
    window.addEventListener('freero:rename-board', onRename);
    return () => window.removeEventListener('freero:rename-board', onRename);
  }, []);

  const commit = () => {
    setEditing(false);
    const next = title.trim() || t('untitledBoard');
    setTitle(next);
    if (next !== host.board.title) {
      host.renameBoard(next).catch(() => {
        host.notify(t('couldNotRenameTheBoard'), 'error');
        setTitle(host.board.title);
      });
    }
  };

  if (editing)
    return (
      <input
        ref={inputRef}
        className="fr-title fr-title--input"
        value={title}
        maxLength={120}
        aria-label={t('boardName')}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setTitle(host.board.title);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <Tooltip content={canRename ? t('renameBoard') : title} side="bottom">
      <button
        type="button"
        className="fr-title"
        onClick={() => canRename && setEditing(true)}
        style={{ cursor: canRename ? 'text' : 'default' }}
      >
        {title || t('untitledBoard')}
      </button>
    </Tooltip>
  );
}

/** A feature command in the board menu: icon + label + shortcut, or a group opening a submenu. */
function BoardMenuItem({ item }: { item: MenuAction }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const Icon = item.icon as ComponentType<{ size?: number }> | undefined;
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-boardmenu__item"
        aria-haspopup={item.submenu ? 'menu' : undefined}
        aria-expanded={item.submenu ? open : undefined}
        onClick={() => (item.submenu ? setOpen((o) => !o) : item.onSelect())}
      >
        <span className="fr-boardmenu__text">
          <span className="fr-boardmenu__icon">{Icon && <Icon size={16} />}</span>
          {item.label}
        </span>
        {item.submenu ? <ChevronRight size={15} /> : item.shortcut && <span className="fr-boardmenu__kbd">{item.shortcut}</span>}
      </button>
      {item.submenu && <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={item.submenu} side="right" align="start" />}
    </>
  );
}

function BoardMenu() {
  const core = useCore();
  const editor = core.editor;
  const role = useRole();
  const settings = useSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const canEdit = ROLE_RANK[role] >= ROLE_RANK.editor;
  const commands = [...core.registry.commands.values()].filter(
    ({ def, feature }) =>
      def.menus?.includes('board') &&
      ROLE_RANK[role] >= ROLE_RANK[def.minRole ?? 'editor'] &&
      (!def.when || def.when(core.scoped(feature))),
  );
  const close = () => setOpen(false);
  const set = (patch: Partial<BoardSettings>) => editor.updateSettings(patch);

  return (
    <>
      <IconButton ref={ref} icon={Ellipsis} label={t('boardMenu')} size={32} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={close} anchor={ref.current} side="bottom" align="start" width={280} className="fr-boardmenu">
        {canEdit && (
          <>
            <button
              type="button"
              className="fr-boardmenu__item"
              onClick={() => {
                close();
                window.dispatchEvent(new Event('freero:rename-board'));
              }}
            >
              <span className="fr-boardmenu__text">
                <span className="fr-boardmenu__icon">
                  <PencilLine size={16} />
                </span>{t('renameBoard')}</span>
            </button>
            <div className="fr-boardmenu__section">
              <div className="fr-boardmenu__label">{t('background')}</div>
              <ColorSwatches
                colors={BACKGROUND_COLORS}
                names={BACKGROUND_NAMES}
                value={settings.background}
                onChange={(c) => set({ background: c })}
                size={22}
                aria-label={t('boardBackground')}
              />
            </div>
            <div className="fr-boardmenu__section">
              <div className="fr-boardmenu__label">{t('grid')}</div>
              <SegmentedControl
                size="sm"
                value={settings.grid}
                onChange={(grid) => set({ grid })}
                options={[...GRID_STYLES]}
                aria-label={t('gridStyle')}
              />
            </div>
            <div className="fr-boardmenu__section">
              <div className="fr-boardmenu__label">{t('gridSize')}</div>
              <SegmentedControl
                size="sm"
                value={String(settings.gridSize)}
                onChange={(v) => set({ gridSize: Number(v) })}
                options={GRID_SIZES.map((n) => ({ value: String(n), label: String(n) }))}
                aria-label={t('gridSize')}
              />
            </div>
            <div className="fr-boardmenu__section">
              <Toggle
                size="sm"
                checked={settings.snapToGrid}
                onChange={(snapToGrid) => set({ snapToGrid })}
                label={t('snapToGrid')}
                aria-label={t('snapToGrid')}
              />
              <span className="fr-boardmenu__hint">{t('hold')}{' '}{isMac ? '⌘' : 'Ctrl'}{' '}{t('whileDraggingToSwitchIt')}</span>
            </div>
            <div className="fr-boardmenu__section">
              <Toggle
                size="sm"
                checked={settings.lineJumps}
                onChange={(lineJumps) => set({ lineJumps })}
                label={t('lineJumps')}
                aria-label={t('lineJumps')}
              />
              <span className="fr-boardmenu__hint">{t('whereConnectorsCrossTheOne')}</span>
            </div>

            <div className="fr-boardmenu__divider" />
          </>
        )}
        {groupCommands(commands, (reg) =>
          commandItem(
            reg,
            () => {
              close();
              reg.def.run(core.scoped(reg.feature));
            },
            core,
          ),
        ).map((item) => ('id' in item ? <BoardMenuItem key={item.id} item={item} /> : null))}
        {commands.length > 0 && <div className="fr-boardmenu__divider" />}
        <button
          type="button"
          className="fr-boardmenu__item"
          onClick={() => {
            close();
            navigator.clipboard
              ?.writeText(`${window.location.origin}/board/${editor.boardId}`)
              .then(() => editor.host.notify(t('boardLinkCopied'), 'success'))
              .catch(() => undefined);
          }}
        >
          <span className="fr-boardmenu__text">
            <span className="fr-boardmenu__icon">
              <Link2 size={16} />
            </span>{t('copyBoardLink')}</span>
        </button>
        <button
          type="button"
          className="fr-boardmenu__item"
          onClick={() => {
            close();
            editor.runCommand('engine.zoomToFit');
          }}
        >
          <span className="fr-boardmenu__text">
            <span className="fr-boardmenu__icon">
              <Maximize size={16} />
            </span>{t('zoomToFit')}</span>
          <span className="fr-boardmenu__kbd">{formatShortcut('shift+1')}</span>
        </button>
        <button
          type="button"
          className="fr-boardmenu__item"
          onClick={() => {
            close();
            editor.host.navigate('/app');
          }}
        >
          <span className="fr-boardmenu__text">
            <span className="fr-boardmenu__icon">
              <ArrowLeft size={16} />
            </span>{t('backToDashboard')}</span>
        </button>
      </Popover>
    </>
  );
}

export function TopLeft() {
  const core = useCore();
  const role = useRole();
  return (
    <div className="fr-topleft" data-fr-chrome="" data-fr-occludes="" data-fr-region="board" role="region" aria-label={t('board')}>
      <div className="fr-chrome-card fr-topleft__card">
        <Tooltip content={t('backToDashboard')} side="bottom">
          <button type="button" className="fr-logo-btn" aria-label={t('backToDashboard')} onClick={() => core.hostRef.current.navigate('/app')}>
            <Logo size={26} />
          </button>
        </Tooltip>
        <div className="fr-topleft__sep" />
        <BoardTitle />
        <BoardMenu />
        {role === 'viewer' && (
          <span className="fr-rolebadge">
            <Eye size={13} />{' '}{t('viewOnly')}</span>
        )}
        {role === 'commenter' && (
          <span className="fr-rolebadge">
            <MessageSquare size={13} />{' '}{t('canComment')}</span>
        )}
      </div>
      <PanelSlotView slot="topbar-left" className="fr-slot-row" />
    </div>
  );
}

export function TopRight() {
  const core = useCore();
  const { topbarAccessory } = useContext(AppChromeContext);
  return (
    <div className="fr-topright" data-fr-chrome="" data-fr-occludes="" data-fr-region="people" role="region" aria-label={t('peopleAndSharing')}>
      <PanelSlotView slot="topbar-right" className="fr-chrome-card fr-slot-row fr-topright__panels" />
      {topbarAccessory ? <div className="fr-chrome-card fr-topright__app">{topbarAccessory}</div> : null}
      <Button variant="primary" icon={Share2} onClick={() => core.hostRef.current.openShareDialog()}>{t('share')}</Button>
    </div>
  );
}
