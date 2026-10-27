import { useEffect, useMemo, useRef, useState } from 'react';
import { Crosshair, Eye, EyeOff, Megaphone, SmilePlus } from 'lucide-react';
import { definePanel, usePeers, usePointer, type Editor } from '@engine';
import { Avatar, Button, IconButton, Popover, Tooltip, useToast } from '@ui';
import {
  REACTIONS,
  cameraToShow,
  newSignals,
  peopleOnBoard,
  primaryClient,
  readExt,
  sameCamera,
  stepCamera,
  takeToken,
  type Bucket,
  type Peer,
  type Person,
  type PresenceExt,
} from './lib/model';
import { bringEveryone, burstOrigin, sendReaction, showBurst, startFollowing, stopFollowing, usePresenceUi, presenceStore } from './lib/state';
import './presence.css';

const MAX_SHOWN = 4;
const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' } as const;

function jumpTo(editor: Editor, person: Person) {
  const c = primaryClient(person);
  if (!c?.viewport) return false;
  stopFollowing(editor);
  editor.setCamera(cameraToShow(c.viewport, editor.getViewportSize()), { animate: true });
  return true;
}

function useFollowers(peers: Peer[], userId: string): number {
  return useMemo(() => new Set(peers.filter((p) => readExt(p).following === userId).map((p) => p.user.id)).size, [peers, userId]);
}

// ---------------------------------------------------------------------------
// Avatar stack (topbar-right)
// ---------------------------------------------------------------------------
function PersonCard({ editor, person, onDone }: { editor: Editor; person: Person; onDone: () => void }) {
  const following = usePresenceUi(editor, (s) => s.following);
  const peers = usePeers();
  const followers = useFollowers(peers, editor.user.id);
  const isFollowed = following?.userId === person.userId;
  const client = primaryClient(person);
  const tabs = person.clients.length;
  const subtitle = person.isMe
    ? followers
      ? `${followers} ${followers === 1 ? 'person is' : 'people are'} following you`
      : `${ROLE_LABEL[editor.getRole()]}${tabs ? ` · also open in ${tabs} other tab${tabs === 1 ? '' : 's'}` : ''}`
    : client?.viewport
      ? isFollowed
        ? 'You are following their view'
        : 'Viewing this board'
      : 'Just joined';
  return (
    <div className="fr-presence-card">
      <div className="fr-presence-card__who">
        <Avatar name={person.name} color={person.color} src={person.avatarUrl} size={36} />
        <div className="fr-presence-card__text">
          <div className="fr-presence-card__name">{person.isMe ? `${person.name} (you)` : person.name}</div>
          <div className="fr-presence-card__sub">{subtitle}</div>
        </div>
      </div>
      {!person.isMe && (
        <div className="fr-presence-card__actions">
          <Button
            size="sm"
            icon={Crosshair}
            disabled={!client?.viewport}
            onClick={() => {
              jumpTo(editor, person);
              onDone();
            }}
          >
            Go to view
          </Button>
          {isFollowed ? (
            <Button size="sm" icon={EyeOff} onClick={() => stopFollowing(editor)}>
              Stop following
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={Eye}
              disabled={!client?.viewport}
              onClick={() => {
                startFollowing(editor, { userId: person.userId, name: person.name, color: person.color });
                onDone();
              }}
            >
              Follow
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function BringEveryone({ editor, onDone }: { editor: Editor; onDone: () => void }) {
  return (
    <button
      type="button"
      className="fr-presence-menuitem"
      onClick={() => {
        bringEveryone(editor);
        onDone();
      }}
    >
      <Megaphone size={16} />
      <span>Bring everyone to me</span>
    </button>
  );
}

function PeopleList({ editor, people, onDone }: { editor: Editor; people: Person[]; onDone: () => void }) {
  const following = usePresenceUi(editor, (s) => s.following);
  return (
    <div className="fr-presence-list">
      <div className="fr-presence-list__heading">On this board · {people.length}</div>
      <div className="fr-presence-list__rows" data-fr-scrollable="">
        {people.map((p) => {
          const c = primaryClient(p);
          const isFollowed = following?.userId === p.userId;
          return (
            <div key={p.userId} className="fr-presence-row">
              <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={28} />
              <span className="fr-presence-row__name">
                {p.name}
                {p.isMe && <span className="fr-presence-row__you"> (you)</span>}
              </span>
              {!p.isMe && (
                <span className="fr-presence-row__actions">
                  <IconButton
                    icon={Crosshair}
                    label={`Go to ${p.name}'s view`}
                    size={32}
                    disabled={!c?.viewport}
                    onClick={() => {
                      jumpTo(editor, p);
                      onDone();
                    }}
                  />
                  <IconButton
                    icon={isFollowed ? EyeOff : Eye}
                    label={isFollowed ? 'Stop following' : `Follow ${p.name}`}
                    size={32}
                    active={isFollowed}
                    disabled={!c?.viewport}
                    onClick={() => {
                      if (isFollowed) stopFollowing(editor);
                      else {
                        startFollowing(editor, { userId: p.userId, name: p.name, color: p.color });
                        onDone();
                      }
                    }}
                  />
                </span>
              )}
            </div>
          );
        })}
      </div>
      {people.length > 1 && (
        <>
          <div className="fr-presence-sep" />
          <BringEveryone editor={editor} onDone={onDone} />
        </>
      )}
    </div>
  );
}

function AvatarsPanel({ editor }: { editor: Editor }) {
  const peers = usePeers();
  const people = useMemo(() => peopleOnBoard(editor.user, peers), [editor.user, peers]);
  const following = usePresenceUi(editor, (s) => s.following);
  const [open, setOpen] = useState<{ userId: string | '*'; el: HTMLElement } | null>(null);
  const shown = people.length > MAX_SHOWN ? people.slice(0, MAX_SHOWN - 1) : people;
  const rest = people.length - shown.length;
  const openPerson = open && open.userId !== '*' ? people.find((p) => p.userId === open.userId) : undefined;
  const close = () => setOpen(null);

  // Whoever you follow leaves → stop, and say so.
  useEffect(() => {
    if (following && !people.some((p) => p.userId === following.userId && p.clients.length)) {
      stopFollowing(editor);
      editor.host.notify(`${following.name} left the board`);
    }
  }, [editor, following, people]);

  return (
    <div className="fr-presence-stack" role="group" aria-label="People on this board">
      {shown.map((p) => (
        <Tooltip key={p.userId} content={p.isMe ? `${p.name} (you)` : p.name} side="bottom">
          <button
            type="button"
            className={`fr-presence-stack__item${following?.userId === p.userId ? ' is-followed' : ''}`}
            style={{ ['--fr-presence-color' as string]: p.color }}
            aria-label={p.isMe ? `${p.name} (you)` : p.name}
            aria-expanded={open?.userId === p.userId}
            onClick={(e) => {
              const el = e.currentTarget;
              if (open?.userId === p.userId) return close();
              if (!p.isMe) jumpTo(editor, p);
              setOpen({ userId: p.userId, el });
            }}
          >
            <Avatar name={p.name} color={p.color} src={p.avatarUrl} size={30} ring />
          </button>
        </Tooltip>
      ))}
      {rest > 0 && (
        <Tooltip content="Everyone on this board" side="bottom">
          <button
            type="button"
            className="fr-presence-stack__item fr-presence-stack__more"
            aria-label={`${rest} more people`}
            aria-expanded={open?.userId === '*'}
            onClick={(e) => (open?.userId === '*' ? close() : setOpen({ userId: '*', el: e.currentTarget }))}
          >
            +{rest}
          </button>
        </Tooltip>
      )}
      <Popover open={!!openPerson} onClose={close} anchor={open?.el ?? null} side="bottom" align="end" width={280} aria-label="Person">
        {openPerson && (
          <>
            <PersonCard editor={editor} person={openPerson} onDone={close} />
            {people.length > 1 && (
              <>
                <div className="fr-presence-sep" />
                <BringEveryone editor={editor} onDone={close} />
              </>
            )}
          </>
        )}
      </Popover>
      <Popover open={open?.userId === '*'} onClose={close} anchor={open?.el ?? null} side="bottom" align="end" width={300} aria-label="Everyone on this board">
        <PeopleList editor={editor} people={people} onDone={close} />
      </Popover>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reactions (topbar-right)
// ---------------------------------------------------------------------------
/** Remembers the last world pointer position on the canvas (renders nothing). */
function PointerMemory({ target }: { target: { current: { x: number; y: number } | null } }) {
  const p = usePointer();
  if (p) target.current = p;
  return null;
}

function ReactionsPanel({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [denied, setDenied] = useState(0);
  const ref = useRef<HTMLButtonElement>(null);
  // Your pointer is on the toolbar while you click, so bursts start where it last was on the canvas.
  const lastCursor = useRef<{ x: number; y: number } | null>(null);
  return (
    <>
      <PointerMemory target={lastCursor} />
      <IconButton ref={ref} icon={SmilePlus} label="React" size={32} active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="end" aria-label="Send a reaction">
        <div className={`fr-presence-reactions${denied ? ' is-denied' : ''}`} key={denied}>
          {REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="fr-presence-reactions__btn"
              aria-label={`React ${emoji}`}
              onClick={() => {
                const ok = sendReaction(editor, emoji, lastCursor.current);
                if (!ok) setDenied((d) => d + 1);
              }}
            >
              {emoji}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

// ---------------------------------------------------------------------------
// Screen overlay: follow frame + pill, reaction bursts, summons.
// ---------------------------------------------------------------------------
function FollowController({ editor }: { editor: Editor }) {
  const following = usePresenceUi(editor, (s) => s.following);
  useEffect(() => {
    if (!following) return;
    let expected = editor.getCamera();
    let applying = false;
    let raf = 0;
    // Cancel any camera animation in flight so it can't be mistaken for the user moving.
    editor.setCamera(expected);
    const offCamera = editor.on('camera', () => {
      if (applying) return;
      if (!sameCamera(editor.getCamera(), expected)) stopFollowing(editor);
    });
    const tick = () => {
      const target = editor.getPeers().filter((p) => p.user?.id === following.userId);
      const client = primaryClient({ userId: following.userId, name: '', color: '', avatarUrl: null, isMe: false, clients: target });
      if (client?.viewport) {
        const size = editor.getViewportSize();
        const goal = cameraToShow(client.viewport, size);
        const cur = editor.getCamera();
        if (!sameCamera(cur, goal, 0.25)) {
          applying = true;
          editor.setCamera(stepCamera(cur, goal, 0.2, size));
          applying = false;
        }
        expected = editor.getCamera();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      offCamera();
    };
  }, [editor, following]);
  if (!following) return null;
  return (
    <>
      <div className="fr-presence-frame" style={{ borderColor: following.color }} aria-hidden />
      <div className="fr-presence-pill" data-fr-interactive="" style={{ background: following.color }} role="status">
        <Eye size={14} />
        <span>Following {following.name}</span>
        <span className="fr-presence-pill__dot">·</span>
        <button type="button" onClick={() => stopFollowing(editor)}>
          Stop
        </button>
      </div>
    </>
  );
}

const PARTICLES = 7;

function Bursts({ editor }: { editor: Editor }) {
  const bursts = usePresenceUi(editor, (s) => s.bursts);
  return (
    <>
      {bursts.map((b) => (
        <div key={b.id} className="fr-presence-burst" style={{ transform: `translate(${b.x}px, ${b.y}px)` }} aria-hidden>
          {Array.from({ length: PARTICLES }, (_, i) => {
            // Deterministic per burst so re-renders don't reshuffle particles.
            const seed = (b.id.charCodeAt(i % b.id.length) * (i + 3)) % 97;
            const dx = ((seed / 97) * 2 - 1) * 70;
            const rise = 150 + ((seed * 7) % 90);
            const delay = i * 70 + (seed % 5) * 20;
            const size = 22 + ((seed * 3) % 14);
            return (
              <span
                key={i}
                className="fr-presence-burst__p"
                style={{
                  ['--dx' as string]: `${dx}px`,
                  ['--rise' as string]: `${-rise}px`,
                  ['--rot' as string]: `${((seed % 9) - 4) * 6}deg`,
                  animationDelay: `${delay}ms`,
                  fontSize: size,
                }}
              >
                {b.emoji}
              </span>
            );
          })}
          <span className="fr-presence-burst__name" style={{ background: b.color }}>
            {b.name}
          </span>
        </div>
      ))}
    </>
  );
}

function SignalWatcher({ editor }: { editor: Editor }) {
  const peers = usePeers();
  const notify = useToast();
  const seenReactions = useRef(new Map<number, string | null>());
  const seenSummons = useRef(new Map<number, string | null>());
  // Receivers throttle too, so a client that ignores the sender-side limit can't flood screens.
  const buckets = useRef(new Map<number, Bucket>());
  useEffect(() => {
    for (const { peer, signal } of newSignals(seenReactions.current, peers, (e: PresenceExt) => e.reaction)) {
      const { ok, bucket } = takeToken(buckets.current.get(peer.clientId) ?? { tokens: 3, at: Date.now() }, Date.now());
      buckets.current.set(peer.clientId, bucket);
      if (!ok) continue;
      const o = burstOrigin(editor, signal.at ?? peer.cursor);
      showBurst(editor, { emoji: signal.emoji, x: o.x, y: o.y, name: peer.user.name, color: peer.user.color });
    }
    for (const { peer } of newSignals(seenSummons.current, peers, (e: PresenceExt) => e.summon)) {
      if (peer.user.id === editor.user.id) continue; // your own other tab
      const clientId = peer.clientId;
      notify(`${peer.user.name} is asking everyone to join their view`, 'info', {
        duration: 12000,
        action: {
          label: 'Go',
          onClick: () => {
            // Their live view if they're still here, else where they were when they asked.
            const live = editor.getPeers().find((p) => p.clientId === clientId);
            const vp = live?.viewport ?? readExt(peer).summon?.viewport;
            if (!vp) return;
            stopFollowing(editor);
            editor.setCamera(cameraToShow(vp, editor.getViewportSize()), { animate: true });
          },
        },
      });
    }
  }, [editor, peers, notify]);
  return null;
}

function PresenceOverlay({ editor }: { editor: Editor }) {
  // Make sure the session store exists before children subscribe.
  presenceStore(editor);
  return (
    <div className="fr-presence-overlay">
      <FollowController editor={editor} />
      <Bursts editor={editor} />
      <SignalWatcher editor={editor} />
    </div>
  );
}

export default [
  definePanel({ id: 'presence.avatars', slot: 'topbar-right', order: 10, Component: AvatarsPanel }),
  definePanel({ id: 'presence.reactions', slot: 'topbar-right', order: 12, Component: ReactionsPanel }),
  definePanel({ id: 'presence.overlay', slot: 'screen-overlay', order: 10, Component: PresenceOverlay }),
];
