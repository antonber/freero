// Top-left: logo, inline-editable title, board ⋯ menu, topbar-left panels.
// Top-right: topbar-right panels + Share.
import { useEffect, useRef, useState } from 'react';
import { Ellipsis, Eye, Link2, MessageSquare, Share2 } from 'lucide-react';
import { Button, ColorSwatches, IconButton, Logo, Popover, SegmentedControl, Tooltip } from '@ui';
import type { BoardSettings } from '@freero/shared';
import { useCore } from '../context';
import { useRole, useSettings } from '../hooks';
import { ROLE_RANK } from '../runtime/core';
import { PanelSlotView } from './PanelSlot';
import { formatShortcut } from '../runtime/shortcuts';

export const BACKGROUNDS = ['#F3F2F8', '#FFFFFF', '#F6F1E7', '#EAF4EE', '#E9F1FB', '#F8ECF1', '#2A2838', '#16151F'];
const BACKGROUND_NAMES: Record<string, string> = {
  '#F3F2F8': 'Mist',
  '#FFFFFF': 'White',
  '#F6F1E7': 'Paper',
  '#EAF4EE': 'Sage',
  '#E9F1FB': 'Sky',
  '#F8ECF1': 'Blush',
  '#2A2838': 'Dusk',
  '#16151F': 'Night',
};

function BoardTitle() {
  const core = useCore();
  const host = core.hostRef.current;
  const role = useRole();
  const canRename = ROLE_RANK[role] >= ROLE_RANK.editor;
  const [title, setTitle] = useState(host.board.title);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setTitle(host.board.title), [host.board.title]);
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
    const next = title.trim() || 'Untitled board';
    setTitle(next);
    if (next !== host.board.title) {
      host.renameBoard(next).catch(() => {
        host.notify('Could not rename the board', 'error');
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
        aria-label="Board name"
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
    <Tooltip content={canRename ? 'Rename board' : title} side="bottom">
      <button
        type="button"
        className="fr-title"
        onClick={() => canRename && setEditing(true)}
        style={{ cursor: canRename ? 'text' : 'default' }}
      >
        {title || 'Untitled board'}
      </button>
    </Tooltip>
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
      <IconButton ref={ref} icon={Ellipsis} label="Board menu" size={32} active={open} onClick={() => setOpen((o) => !o)} />
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
              Rename board
            </button>
            <div className="fr-boardmenu__section">
              <div className="fr-boardmenu__label">Background</div>
              <ColorSwatches
                colors={BACKGROUNDS}
                names={BACKGROUND_NAMES}
                value={settings.background}
                onChange={(c) => set({ background: c })}
                size={22}
                aria-label="Board background"
              />
            </div>
            <div className="fr-boardmenu__section">
              <div className="fr-boardmenu__label">Grid</div>
              <SegmentedControl
                size="sm"
                value={settings.grid}
                onChange={(grid) => set({ grid })}
                options={[
                  { value: 'dots', label: 'Dots' },
                  { value: 'lines', label: 'Lines' },
                  { value: 'none', label: 'None' },
                ]}
                aria-label="Grid style"
              />
            </div>
            <div className="fr-boardmenu__divider" />
          </>
        )}
        {commands.map(({ def, feature }) => (
          <button
            key={def.id}
            type="button"
            className="fr-boardmenu__item"
            onClick={() => {
              close();
              def.run(core.scoped(feature));
            }}
          >
            <span>{def.label}</span>
            {def.shortcut && <span className="fr-boardmenu__kbd">{formatShortcut(def.shortcut)}</span>}
          </button>
        ))}
        {commands.length > 0 && <div className="fr-boardmenu__divider" />}
        <button
          type="button"
          className="fr-boardmenu__item"
          onClick={() => {
            close();
            navigator.clipboard
              ?.writeText(`${window.location.origin}/board/${editor.boardId}`)
              .then(() => editor.host.notify('Board link copied', 'success'))
              .catch(() => undefined);
          }}
        >
          <span>Copy board link</span>
          <Link2 size={15} />
        </button>
        <button
          type="button"
          className="fr-boardmenu__item"
          onClick={() => {
            close();
            editor.zoomToFit();
          }}
        >
          <span>Zoom to fit</span>
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
          Back to dashboard
        </button>
      </Popover>
    </>
  );
}

export function TopLeft() {
  const core = useCore();
  const role = useRole();
  return (
    <div className="fr-topleft" data-fr-chrome="">
      <div className="fr-chrome-card fr-topleft__card">
        <Tooltip content="Back to dashboard" side="bottom">
          <button type="button" className="fr-logo-btn" aria-label="Back to dashboard" onClick={() => core.hostRef.current.navigate('/app')}>
            <Logo size={26} />
          </button>
        </Tooltip>
        <div className="fr-topleft__sep" />
        <BoardTitle />
        <BoardMenu />
        {role === 'viewer' && (
          <span className="fr-rolebadge">
            <Eye size={13} /> View only
          </span>
        )}
        {role === 'commenter' && (
          <span className="fr-rolebadge">
            <MessageSquare size={13} /> Can comment
          </span>
        )}
      </div>
      <PanelSlotView slot="topbar-left" className="fr-slot-row" />
    </div>
  );
}

export function TopRight() {
  const core = useCore();
  return (
    <div className="fr-topright" data-fr-chrome="">
      <PanelSlotView slot="topbar-right" className="fr-chrome-card fr-slot-row fr-topright__panels" />
      <Button variant="primary" icon={Share2} onClick={() => core.hostRef.current.openShareDialog()}>
        Share
      </Button>
    </div>
  );
}
