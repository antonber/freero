import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Eye, MonitorPlay, Users, X } from 'lucide-react';
import { definePanel, useElements, usePeers, type Editor } from '@engine';
import { Avatar, Button, IconButton, Menu } from '@ui';
import { activePresenter, currentPosition, navKey, readExt, slides } from './lib/model';
import {
  bringEveryone,
  goTo,
  jumpToViewport,
  mirror,
  presentStore,
  refit,
  startPresenting,
  step,
  stopPresenting,
  usePresent,
} from './lib/session';
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

  // Keyboard: navigation keys drive the deck; everything else is swallowed so board shortcuts
  // (tools, delete, nudge…) can't change the board behind a hidden UI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="menu"], input, textarea, [contenteditable="true"]')) return;
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
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
      <div className="fr-present-catcher" data-fr-interactive="" />
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
        {others > 0 && <IconButton icon={Users} label="Bring everyone to me" size={32} onClick={() => bringEveryone(editor)} />}
        <Button size="sm" variant="ghost" icon={X} className="fr-present-bar__exit" onClick={() => stopPresenting(editor)}>
          Exit
        </Button>
      </div>
    </>
  );
}

// ---------------------------------------------------------------- everyone else
/** Banner "<Name> is presenting", following, and "Bring everyone to me" for non-presenters. */
function AudienceOverlay({ editor }: { editor: Editor }) {
  const peers = usePeers();
  const presenting = usePresent(editor, (s) => s.presenting);
  const following = usePresent(editor, (s) => s.following);
  const dismissed = usePresent(editor, (s) => s.dismissed);
  const presenter = activePresenter(peers, editor.user.id);
  const pres = presenter ? readExt(presenter).presenting : null;
  const sessionKey = presenter && pres ? `${presenter.clientId}:${pres.startedAt}` : null;
  const followed = following !== null ? peers.find((p) => p.clientId === following) : undefined;
  const followedPres = followed ? readExt(followed).presenting : null;
  const store = presentStore(editor);

  // Follow: mirror the presenter's slide whenever it changes.
  const expectCameraUntil = useRef(0);
  const followedFrame = followedPres ? followedPres.frameId : undefined;
  useEffect(() => {
    if (!followed || followedFrame === undefined) return;
    expectCameraUntil.current = performance.now() + 700;
    mirror(editor, followed, followedFrame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, followed?.clientId, followedFrame]);

  // The presenter stopped or left: stop following and say so.
  useEffect(() => {
    if (following === null || followedPres) return;
    store.setState({ following: null });
    editor.host.notify(followed ? `${followed.user.name} ended the presentation` : 'The presentation ended');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following, !!followedPres]);

  // Taking the camera yourself (pan, zoom) or pressing Esc stops following.
  useEffect(() => {
    if (following === null) return;
    const stop = () => store.setState({ following: null });
    const offCam = editor.on('camera', () => {
      if (performance.now() > expectCameraUntil.current) stop();
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      offCam();
      window.removeEventListener('keydown', onKey, true);
    };
  }, [editor, following, store]);

  // "Bring everyone to me": jump once to the summoner's viewport for each new nonce. Nonces seen
  // on first sight (issued before we joined) are recorded, not acted on.
  const seen = useRef(new Map<number, string | null>());
  useEffect(() => {
    for (const p of peers) {
      const nonce = readExt(p).summon?.nonce ?? null;
      const known = seen.current.has(p.clientId);
      const prev = seen.current.get(p.clientId) ?? null;
      seen.current.set(p.clientId, nonce);
      if (!known || !nonce || nonce === prev || presenting || p.user?.id === editor.user.id) continue;
      expectCameraUntil.current = performance.now() + 700;
      jumpToViewport(editor, p);
      editor.host.notify(`${p.user.name} brought everyone to their view`);
    }
  }, [editor, peers, presenting]);

  if (presenting || !presenter || !pres) return null;
  if (following === presenter.clientId) {
    return (
      <div className="fr-present-banner is-following" data-fr-interactive="" role="status">
        <Avatar name={presenter.user.name} color={presenter.user.color} src={presenter.user.avatarUrl ?? undefined} size={24} />
        <span>
          Following <strong>{presenter.user.name}</strong>
        </span>
        <Button size="sm" variant="ghost" onClick={() => store.setState({ following: null })}>
          Stop
        </Button>
      </div>
    );
  }
  if (sessionKey && dismissed.includes(sessionKey)) return null;
  return (
    <div className="fr-present-banner" data-fr-interactive="" role="status">
      <Avatar name={presenter.user.name} color={presenter.user.color} src={presenter.user.avatarUrl ?? undefined} size={24} />
      <span>
        <strong>{presenter.user.name}</strong> is presenting
      </span>
      <Button size="sm" variant="primary" icon={Eye} onClick={() => store.setState({ following: presenter.clientId })}>
        Follow
      </Button>
      <Button size="sm" variant="ghost" onClick={() => sessionKey && store.setState({ dismissed: [...dismissed, sessionKey] })}>
        Dismiss
      </Button>
    </div>
  );
}

function Overlay({ editor }: { editor: Editor }) {
  const presenting = usePresent(editor, (s) => s.presenting);
  // Leaving the board mid-presentation must not leave the chrome hidden for the next board.
  useEffect(() => () => stopPresenting(editor), [editor]);
  return presenting ? <PresenterOverlay editor={editor} /> : <AudienceOverlay editor={editor} />;
}

export default [
  definePanel({ id: 'present.button', slot: 'topbar-right', order: 80, Component: PresentButton }),
  definePanel({ id: 'present.overlay', slot: 'screen-overlay', order: 80, Component: Overlay }),
];

