// Facilitator controls: the session bar (top-center) and the parts each client applies itself.
//
// The lock and the allowed types are enforced by the server; this client sees their effect
// through the engine (its role / Editor.getLimits come from the server's role message). What
// stays here is the view: following the facilitator (a locked engine follow) and hidden cursors.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Crosshair, Lock, LockOpen, MousePointer2, Presentation, Shapes, X } from 'lucide-react';
import { FACILITATION_COLLECTION, FACILITATION_KEY, type FacilitationSession } from '@freero/shared';
import { definePanel, describeElementType, useCollection, useLimits, usePeers, type Editor } from '@engine';
import { Avatar, Button, Popover, Tooltip } from '@ui';
import { canManage, change, cursorsHiddenFor, end, readSession, useCursorPrefs } from './lib/session';
import './facilitation.css';

function useSession(): FacilitationSession | undefined {
  const entries = useCollection<FacilitationSession>(FACILITATION_COLLECTION);
  return useMemo(() => readSession(entries.find(([k]) => k === FACILITATION_KEY)?.[1]), [entries]);
}

/** Following and hidden cursors: views, so every client applies them to itself. */
function useApplyView(editor: Editor, session: FacilitationSession | undefined): void {
  const hideMine = useCursorPrefs((s) => s.hideMine);
  const hidden = cursorsHiddenFor(editor.user.id, session, hideMine);
  useEffect(() => editor.setCursorsHidden(hidden), [editor, hidden]);
  useEffect(() => () => editor.setCursorsHidden(false), [editor]);

  const leader = session?.follow && session.by !== editor.user.id ? session.by : null;
  useEffect(() => {
    if (!leader) return;
    editor.follow({ userId: leader, locked: true }, { force: true });
    return () => {
      if (editor.getFollowing()?.locked) editor.follow(null, { force: true });
    };
  }, [editor, leader]);
}

function FacilitationBar({ editor }: { editor: Editor }) {
  const session = useSession();
  useApplyView(editor, session);
  if (!session) return null;
  return session.by === editor.user.id || canManage(editor, session) ? (
    <FacilitatorBar editor={editor} session={session} />
  ) : (
    <ParticipantBar editor={editor} session={session} />
  );
}

function typeNames(editor: Editor, types: string[]): string {
  return types.map((t) => describeElementType(editor, t).many.toLowerCase()).join(', ') || 'nothing';
}

function FacilitatorBar({ editor, session }: { editor: Editor; session: FacilitationSession }) {
  const others = usePeers().filter((p) => p.user?.id !== session.by);
  const people = new Set(others.map((p) => p.user.id)).size;
  const typesRef = useRef<HTMLButtonElement>(null);
  const [typesOpen, setTypesOpen] = useState(false);
  const mine = session.by === editor.user.id;
  const types = session.allowedTypes;

  return (
    <div className="fr-facil-bar" data-fr-interactive="" role="region" aria-label="Facilitator controls">
      <span className="fr-facil-bar__icon">
        <Presentation size={16} />
      </span>
      <div className="fr-facil-bar__text">
        <strong>{mine ? 'You are facilitating' : `${session.byName} is facilitating`}</strong>
        <span>
          {people} participant{people === 1 ? '' : 's'}
          {mine ? '' : ' · you can change or end it as the owner'}
        </span>
      </div>
      <div className="fr-facil-bar__controls">
        <Tooltip content={session.locked ? 'Participants can only comment. Click to unlock.' : 'Make the board comment-only for participants'} side="bottom">
          <Button
            size="sm"
            variant="ghost"
            className={session.locked ? 'is-on' : undefined}
            aria-pressed={session.locked}
            icon={session.locked ? Lock : LockOpen}
            onClick={() => change(editor, { locked: !session.locked })}
          >
            {session.locked ? 'Locked' : 'Lock board'}
          </Button>
        </Tooltip>
        <Button
          ref={typesRef}
          size="sm"
          variant="ghost"
          className={types ? 'is-on' : undefined}
          aria-haspopup="dialog"
          aria-expanded={typesOpen}
          icon={Shapes}
          onClick={() => setTypesOpen((o) => !o)}
        >
          {types ? `Adding: ${types.length ? describeElementType(editor, types[0]).many : 'nothing'}${types.length > 1 ? ` +${types.length - 1}` : ''}` : 'Any tool'}
        </Button>
        <Popover open={typesOpen} onClose={() => setTypesOpen(false)} anchor={typesRef.current} side="bottom" align="center" width={260}>
          <ToolPicker editor={editor} session={session} />
        </Popover>
        <Tooltip content={session.follow ? "Participants see what you see and can't wander off" : 'Make everyone follow your view'} side="bottom">
          <Button
            size="sm"
            variant="ghost"
            className={session.follow ? 'is-on' : undefined}
            aria-pressed={session.follow}
            icon={Crosshair}
            onClick={() => change(editor, { follow: !session.follow })}
          >
            Follow me
          </Button>
        </Tooltip>
        <Tooltip content="Hide everyone's cursors from participants (quiet, independent work)" side="bottom">
          <Button
            size="sm"
            variant="ghost"
            className={session.cursorsHidden ? 'is-on' : undefined}
            aria-pressed={session.cursorsHidden}
            icon={MousePointer2}
            onClick={() => change(editor, { cursorsHidden: !session.cursorsHidden })}
          >
            {session.cursorsHidden ? 'Cursors hidden' : 'Hide cursors'}
          </Button>
        </Tooltip>
      </div>
      <Button size="sm" variant="secondary" icon={X} onClick={() => end(editor)}>
        End
      </Button>
    </div>
  );
}

/** Which element types participants may add: "Any tool", or a chosen set. */
function ToolPicker({ editor, session }: { editor: Editor; session: FacilitationSession }) {
  const addable = useMemo(() => editor.listAddableTypes(), [editor]);
  const chosen = session.allowedTypes;
  const toggle = (type: string) => {
    const base = chosen ?? [];
    const next = base.includes(type) ? base.filter((t) => t !== type) : [...base, type];
    change(editor, { allowedTypes: next });
  };
  return (
    <div className="fr-facil-tools" role="group" aria-label="What participants can add">
      <div className="fr-facil-tools__head">Participants can add</div>
      <button type="button" className="fr-facil-tools__row" aria-pressed={!chosen} onClick={() => change(editor, { allowedTypes: null })}>
        <span className="fr-facil-tools__check">{!chosen && <Check size={14} />}</span>
        Anything
      </button>
      {addable.map((type) => {
        const d = describeElementType(editor, type);
        const on = !!chosen?.includes(type);
        return (
          <button key={type} type="button" className="fr-facil-tools__row" aria-pressed={on} onClick={() => toggle(type)}>
            <span className="fr-facil-tools__check">{on && <Check size={14} />}</span>
            <d.icon size={15} />
            {d.many}
          </button>
        );
      })}
      <p className="fr-facil-tools__note">Comments are always allowed. Existing items can still be moved and edited unless the board is locked.</p>
    </div>
  );
}

function ParticipantBar({ editor, session }: { editor: Editor; session: FacilitationSession }) {
  const limits = useLimits();
  const peers = usePeers();
  const hideMine = useCursorPrefs((s) => s.hideMine);
  const lead = peers.find((p) => p.user?.id === session.by)?.user;
  const notes: string[] = [];
  if (limits?.locked) notes.push('The board is locked: you can comment');
  else if (limits?.addTypes) notes.push(`You can add ${typeNames(editor, limits.addTypes)}`);
  if (session.follow) notes.push(`You're following ${session.byName}`);
  if (session.cursorsHidden) notes.push('Cursors are hidden');
  return (
    <div className="fr-facil-bar is-participant" data-fr-interactive="" role="region" aria-label="Facilitator controls">
      {lead ? (
        <Avatar name={lead.name} color={lead.color} src={lead.avatarUrl ?? undefined} size={28} />
      ) : (
        <span className="fr-facil-bar__icon">
          <Presentation size={16} />
        </span>
      )}
      <div className="fr-facil-bar__text">
        <strong>{session.byName} is facilitating</strong>
        <span>{notes.length ? notes.join(' · ') : 'Work as usual'}</span>
      </div>
      {!session.cursorsHidden && (
        <Tooltip content={hideMine ? 'Show other people’s cursors again' : 'Hide other people’s cursors (only for you)'} side="bottom">
          <Button
            size="sm"
            variant="ghost"
            className={hideMine ? 'is-on' : undefined}
            aria-pressed={hideMine}
            icon={MousePointer2}
            onClick={() => useCursorPrefs.getState().setHideMine(!hideMine)}
          >
            {hideMine ? 'Cursors off' : 'Cursors'}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}

export default definePanel({
  id: 'facilitation.bar',
  slot: 'top-center',
  order: 5,
  Component: FacilitationBar,
});
