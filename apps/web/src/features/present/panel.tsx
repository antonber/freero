import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, MonitorPlay, NotebookText, Users, X, Zap } from 'lucide-react';
import { definePanel, useElements, useFollowing, usePeers, type Editor } from '@engine';
import { Avatar, Button, IconButton, Menu } from '@ui';
import { activePresenter, currentPosition, navKey, readExt, slides } from './lib/model';
import {
  goTo,
  laserAt,
  laserOff,
  presentStore,
  refit,
  startPresenting,
  step,
  stopPresenting,
  usePresent,
} from './lib/session';
import { LaserOverlay } from './lib/LaserOverlay';
import { NotesPanel, PresenterNotes } from './lib/NotesPanel';
import { NOTES_PANEL_ID } from './lib/notes';
import './present.css';

// ---------------------------------------------------------------- top bar button
function PresentButton({ editor }: { editor: Editor }) {
  return (
    <Button size="sm" variant="ghost" icon={MonitorPlay} onClick={() => startPresenting(editor)} title="Present frames one by one">
      Present
    </Button>
  );
}

// ---------------------------------------------------------------- presenter overlay
function PresenterOverlay({ editor }: { editor: Editor }) {
  const elements = useElements('frame');
  const list = useMemo(() => slides(elements), [elements]);
  const frameId = usePresent(editor, (s) => s.frameId);
  const position = usePresent(editor, (s) => s.position);
  const pos = currentPosition(list, frameId, position);
  const [menuOpen, setMenuOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const others = usePeers().filter((p) => p.user?.id !== editor.user.id).length;
  const laser = usePresent(editor, (s) => s.laser);
  const notesOpen = usePresent(editor, (s) => s.notesOpen);
  const store = presentStore(editor);
  const toggleLaser = () => {
    if (store.getState().laser) laserOff(editor);
    store.setState({ laser: !store.getState().laser });
  };
  const toggleNotes = () => store.setState({ notesOpen: !store.getState().notesOpen });

  // Keyboard: navigation keys drive the deck; everything else is swallowed so board shortcuts
  // (tools, delete, nudge…) can't change the board behind a hidden UI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="menu"], input, textarea, [contenteditable="true"]')) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'l' || e.key === 'L') return toggleLaser();
      if (e.key === 'n' || e.key === 'N') return toggleNotes();
      const nav = navKey(e.key, e.shiftKey);
      if (!nav) return;
      e.preventDefault();
      if (nav === 'exit') return stopPresenting(editor);
      if (nav === 'first') return goTo(editor, 0);
      if (nav === 'last') return goTo(editor, Number.MAX_SAFE_INTEGER);
      step(editor, nav);
    };
    const onResize = () => refit(editor);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onResize);
    };
  }, [editor]);

  // The current slide was deleted by someone: land on the neighbour that took its place.
  useEffect(() => {
    if (list.length && frameId && !list.some((f) => f.id === frameId)) goTo(editor, pos);
  }, [editor, list, frameId, pos]);

  const current = pos >= 0 ? list[pos] : null;
  return (
    <>
      {/* Swallows clicks/drags so nothing on the board is selected or moved while presenting. */}
      <div
        className={`fr-present-catcher${laser ? ' is-laser' : ''}`}
        data-fr-interactive=""
        onPointerMove={(e) => {
          if (!laser) return;
          const r = e.currentTarget.getBoundingClientRect();
          laserAt(editor, editor.screenToWorld({ x: e.clientX - r.left, y: e.clientY - r.top }));
        }}
        onPointerLeave={() => laser && laserOff(editor)}
      />
      {notesOpen && current && <PresenterNotes frameId={current.id} onClose={toggleNotes} />}
      {!list.length && (
        <div className="fr-present-hint" role="status">
          No frames yet, so the whole board is shown. Add frames (F) to present it step by step.
        </div>
      )}
      <div className="fr-present-bar" data-fr-interactive="" role="toolbar" aria-label="Presentation controls">
        <IconButton icon={ChevronLeft} label="Previous" shortcut="←" size={32} disabled={pos <= 0} onClick={() => step(editor, -1)} />
        <span className="fr-present-bar__count" aria-live="polite">
          {list.length ? `${pos + 1} / ${list.length}` : 'Board'}
        </span>
        <IconButton
          icon={ChevronRight}
          label="Next"
          shortcut="→"
          size={32}
          disabled={pos < 0 || pos >= list.length - 1}
          onClick={() => step(editor, 1)}
        />
        {list.length > 0 && (
          <>
            <span className="fr-present-bar__sep" />
            <button
              ref={titleRef}
              type="button"
              className="fr-present-bar__title"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((o) => !o)}
            >
              <span>{current?.title || 'Untitled frame'}</span>
              <ChevronDown size={14} />
            </button>
            <Menu
              open={menuOpen}
              onClose={() => setMenuOpen(false)}
              anchor={titleRef.current}
              side="top"
              align="center"
              minWidth={220}
              items={list.map((f, i) => ({
                id: f.id,
                label: `${i + 1}. ${f.title || 'Untitled frame'}`,
                checked: i === pos,
                onSelect: () => goTo(editor, i),
              }))}
            />
          </>
        )}
        <span className="fr-present-bar__sep" />
        <IconButton icon={Zap} label="Laser pointer" shortcut="L" size={32} active={laser} onClick={toggleLaser} />
        {list.length > 0 && <IconButton icon={NotebookText} label="Your notes" shortcut="N" size={32} active={notesOpen} onClick={toggleNotes} />}
        {others > 0 && <IconButton icon={Users} label="Bring everyone to me" size={32} onClick={() => editor.runCommand('presence.bringEveryone')} />}
        <Button size="sm" variant="ghost" icon={X} className="fr-present-bar__exit" onClick={() => stopPresenting(editor)}>
          Exit
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- everyone else
/**
 * Banner "<Name> is presenting · Follow · Dismiss" for everyone else. Following is the one engine
 * follow (Editor.follow, the same as following someone from the avatars): while you follow the
 * presenter, presence's "Following <name>" pill replaces this banner.
 */
function AudienceOverlay({ editor }: { editor: Editor }) {
  const peers = usePeers();
  const presenting = usePresent(editor, (s) => s.presenting);
  const dismissed = usePresent(editor, (s) => s.dismissed);
  const following = useFollowing();
  const presenter = activePresenter(peers, editor.user.id);
  const pres = presenter ? readExt(presenter).presenting : null;
  const sessionKey = presenter && pres ? `${presenter.clientId}:${pres.startedAt}` : null;
  const store = presentStore(editor);

  // Started following from this banner: when that presentation ends, hand the camera back.
  const followedFor = useRef<{ key: string; userId: string; name: string } | null>(null);
  useEffect(() => {
    const f = followedFor.current;
    if (!f) return;
    if (following?.userId !== f.userId) followedFor.current = null; // you stopped or followed someone else
    else if (sessionKey !== f.key) {
      followedFor.current = null;
      editor.follow(null);
      editor.host.notify(`${f.name} ended the presentation`);
    }
  }, [editor, following, sessionKey]);

  if (presenting || !presenter || !pres || !sessionKey) return null;
  if (following?.userId === presenter.user.id) return null;
  if (dismissed.includes(sessionKey)) return null;
  const follow = () => {
    followedFor.current = { key: sessionKey, userId: presenter.user.id, name: presenter.user.name };
    editor.follow({ userId: presenter.user.id, clientId: presenter.clientId });
  };
  return (
    <div className="fr-present-banner" data-fr-interactive="" role="status">
      <Avatar name={presenter.user.name} color={presenter.user.color} src={presenter.user.avatarUrl ?? undefined} size={24} />
      <span>
        <strong>{presenter.user.name}</strong> is presenting
      </span>
      <Button size="sm" variant="primary" icon={Eye} onClick={follow}>
        Follow
      </Button>
      <Button size="sm" variant="ghost" onClick={() => store.setState({ dismissed: [...dismissed, sessionKey] })}>
        Dismiss
      </Button>
    </div>
  );
}

function Overlay({ editor }: { editor: Editor }) {
  const presenting = usePresent(editor, (s) => s.presenting);
  // Leaving the board mid-presentation must not leave the chrome hidden for the next board.
  useEffect(() => () => stopPresenting(editor), [editor]);
  return presenting ? <PresenterOverlay editor={editor} /> : null;
}

export default [
  definePanel({ id: 'present.button', slot: 'topbar-right', order: 80, Component: PresentButton }),
  definePanel({ id: 'present.overlay', slot: 'screen-overlay', order: 80, Component: Overlay }),
  // In the top-center column with other session bars (an active vote), so they never overlap.
  definePanel({ id: 'present.banner', slot: 'top-center', order: 10, Component: AudienceOverlay }),
  // Everyone's laser trails, above the presenter's controls' catcher (pointer events pass through).
  definePanel({ id: 'present.laser', slot: 'screen-overlay', order: 90, Component: LaserOverlay }),
  definePanel({ id: NOTES_PANEL_ID, slot: 'dock-right', order: 60, Component: NotesPanel }),
];

