import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bot, Crosshair, Eye, EyeOff, Megaphone, SmilePlus } from 'lucide-react';
import { definePanel, useCamera, useFollowing, usePeers, usePointer, type Editor } from '@engine';
import { Avatar, Button, IconButton, Popover, Tooltip } from '@ui';
import {
  REACTIONS,
  newSignals,
  peopleOnBoard,
  primaryClient,
  readExt,
  takeToken,
  type Bucket,
  type Peer,
  type Person,
  type PresenceExt,
} from './lib/model';
import { bringEveryone, burstOrigin, sendReaction, showBurst, showView, usePresenceUi, presenceStore } from './lib/state';
import './presence.css';

const MAX_SHOWN = 4;
const ROLE_LABEL = { owner: 'Owner', editor: 'Can edit', commenter: 'Can comment', viewer: 'Can view' } as const;

/** "Go to view": shows what they see right now, once (a camera move, so it also ends following). */
function jumpTo(editor: Editor, person: Person) {
  const c = primaryClient(person);
  if (!c?.viewport) return false;
  showView(editor, c.viewport);
  return true;
}

/** Following is the engine's (Editor.follow): this picks which of their tabs to mirror. */
function follow(editor: Editor, person: Person) {
  editor.follow({ userId: person.userId, clientId: primaryClient(person)?.clientId });
}

function useFollowers(peers: Peer[], userId: string): number {
  return useMemo(() => new Set(peers.filter((p) => p.following === userId).map((p) => p.user.id)).size, [peers, userId]);
}

// ---------------------------------------------------------------------------
// Avatar stack (topbar-right)
// ---------------------------------------------------------------------------
function PersonCard({ editor, person, onDone }: { editor: Editor; person: Person; onDone: () => void }) {
  const following = useFollowing();
  const peers = usePeers();
  const followers = useFollowers(peers, editor.user.id);
  const isFollowed = following?.userId === person.userId;
  const client = primaryClient(person);
  const tabs = person.clients.length;
  // An app writing through the API or MCP for someone (server-published, KAI-168): no view to follow.
  const agent = client?.agent;
  const subtitle = agent
    ? 'An app working on this board for someone'
    : person.isMe
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
        <span className="fr-presence-card__avatar">
          <Avatar name={person.name} color={person.color} src={person.avatarUrl} size={36} />
          {agent ? (
            <span className="fr-presence-card__agent" title="App" aria-label="App">
              <Bot size={12} aria-hidden />
            </span>
          ) : null}
        </span>
        <div className="fr-presence-card__text">
          <div className="fr-presence-card__name">{person.isMe ? `${person.name} (you)` : person.name}</div>
          <div className="fr-presence-card__sub">{subtitle}</div>
        </div>
      </div>
      {!person.isMe && !agent && (
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
          {isFollowed && editor.getFollowing()?.locked ? null : isFollowed ? (
            <Button size="sm" icon={EyeOff} onClick={() => editor.follow(null)}>
              Stop following
            </Button>
          ) : (
            <Button
              size="sm"
              variant="primary"
              icon={Eye}
              disabled={!client?.viewport}
              onClick={() => {
                follow(editor, person);
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
  const following = useFollowing();
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
                      if (isFollowed) editor.follow(null);
                      else {
                        follow(editor, p);
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
  const following = useFollowing();
  const [open, setOpen] = useState<{ userId: string | '*'; el: HTMLElement } | null>(null);
  const shown = people.length > MAX_SHOWN ? people.slice(0, MAX_SHOWN - 1) : people;
  const rest = people.length - shown.length;
  const openPerson = open && open.userId !== '*' ? people.find((p) => p.userId === open.userId) : undefined;
  const close = () => setOpen(null);
  // The person left (or reloaded: their avatar button was re-created): the popover would otherwise
  // reopen anchored to a detached button, i.e. at the window's top-left corner.
  const personGone = !!open && open.userId !== '*' && !openPerson;
  useEffect(() => {
    if (personGone) setOpen(null);
  }, [personGone]);

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
/** Room the pill needs at the bottom of the screen, and the name label's size right of a cursor (px). */
const PILL_ZONE = 64;
const CURSOR_LABEL = { w: 160, h: 40 };

/**
 * While following (Editor.follow): a frame in their color and a "Following <name> · Stop" pill,
 * bottom-center — or top-center while their cursor and name label are where the pill would be.
 * Also says so when the person you follow leaves (the engine then stops following).
 */
function FollowIndicator({ editor }: { editor: Editor }) {
  const following = useFollowing();
  const peers = usePeers();
  useCamera(); // their cursor moves on screen as the camera moves
  const pill = useRef<HTMLDivElement>(null);
  const [pillW, setPillW] = useState(0);
  const mine = following ? peers.filter((p) => p.user?.id === following.userId) : [];
  const who = mine.find((p) => p.clientId === following?.clientId) ?? mine[0];

  // Remember whom, so a stop caused by them leaving can be told apart from you stopping.
  const last = useRef<{ userId: string; name: string } | null>(null);
  if (following && who) last.current = { userId: following.userId, name: who.user.name };
  useEffect(
    () =>
      editor.on('follow', () => {
        const was = last.current;
        if (editor.getFollowing() || !was) return;
        last.current = null;
        if (!editor.getPeers().some((p) => p.user?.id === was.userId)) editor.host.notify(`${was.name} left the board`);
      }),
    [editor],
  );
  useLayoutEffect(() => {
    const w = pill.current?.offsetWidth ?? 0;
    if (w !== pillW) setPillW(w);
  });

  if (!following || !who) return null;
  const vp = editor.getViewportSize();
  const c = who.cursor ? editor.worldToScreen(who.cursor) : null;
  const pillLeft = (vp.width - pillW) / 2;
  const atTop =
    !!c && c.y + CURSOR_LABEL.h > vp.height - PILL_ZONE && c.x + CURSOR_LABEL.w > pillLeft && c.x < pillLeft + pillW;
  const color = who.user.color;
  return (
    <>
      <div className="fr-presence-frame" style={{ borderColor: color }} aria-hidden />
      <div ref={pill} className={`fr-presence-pill${atTop ? ' is-top' : ''}`} data-fr-interactive="" style={{ background: color }} role="status">
        <Eye size={14} />
        <span>Following {who.user.name}</span>
        {/* A facilitator's "follow me" (FollowTarget.locked) ends when they release it. */}
        {!following.locked && (
          <>
            <span className="fr-presence-pill__dot">·</span>
            <button type="button" onClick={() => editor.follow(null)}>
              Stop
            </button>
          </>
        )}
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
      editor.host.notify(`${peer.user.name} is asking everyone to join their view`, 'info', {
        action: {
          label: 'Go',
          run: () => {
            // Their live view if they're still here, else where they were when they asked.
            const live = editor.getPeers().find((p) => p.clientId === clientId);
            const vp = live?.viewport ?? readExt(peer).summon?.viewport;
            if (vp) showView(editor, vp);
          },
        },
      });
    }
  }, [editor, peers]);
  return null;
}

function PresenceOverlay({ editor }: { editor: Editor }) {
  // Make sure the session store exists before children subscribe.
  presenceStore(editor);
  return (
    <div className="fr-presence-overlay">
      <FollowIndicator editor={editor} />
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
