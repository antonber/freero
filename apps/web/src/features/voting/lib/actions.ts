// Editor-bound voting actions (shared by panels and commands). Only the voting feature's scoped
// editor may call these: the `voting` collection is owned by this feature.
import { nanoid } from 'nanoid';
import type { Editor } from '@engine';
import {
  ballotKey,
  castVote,
  clearSession,
  countedVotes,
  endSession,
  getSession,
  isEligible,
  retractVote,
  startSession,
  syncSealedMarker,
  type Ballot,
  type SessionOptions,
  type VotingValue,
} from './voting';
import { RESULTS_PANEL_ID } from './state';

const COLLECTION = 'voting';
const store = (editor: Editor) => editor.collection<VotingValue>(COLLECTION);
/** This user's sealed ballots (hidden results): the server shows them to nobody until revealed. */
const sealed = (editor: Editor) => editor.privateCollection<VotingValue>(COLLECTION);
const actor = (editor: Editor) => ({ id: editor.user.id, name: editor.user.name, color: editor.user.color });

function existsFor(editor: Editor) {
  const session = getSession(store(editor));
  return (id: string) => {
    const el = editor.getElement(id);
    return !!el && !!session && isEligible(session, el);
  };
}

/** Where this user's ballot for `session` lives: sealed while results are hidden. */
const ballotsFor = (editor: Editor, anonymous: boolean) => (anonymous ? sealed(editor) : store(editor));

/** Hidden results: the shared "has voted" marker follows the sealed ballot. */
function afterSealedChange(editor: Editor): void {
  const session = getSession(store(editor));
  if (!session?.active || !session.anonymous) return;
  const own = countedVotes(sealed(editor).get(ballotKey(session.id, editor.user.id)) as Ballot | undefined, session, existsFor(editor));
  syncSealedMarker(store(editor), session, actor(editor), own.length);
}

export function vote(editor: Editor, elementId: string): void {
  const s = store(editor);
  const session = getSession(s);
  if (!session?.active || !editor.can('editor')) return;
  if (!castVote(s, actor(editor), elementId, existsFor(editor), ballotsFor(editor, session.anonymous)))
    editor.host.notify(`You've used all ${session.votesPerUser} of your votes. Remove one to vote again.`, 'info');
  else afterSealedChange(editor);
}

export function unvote(editor: Editor, elementId: string): void {
  const session = getSession(store(editor));
  if (!session || !editor.can('editor')) return;
  if (retractVote(store(editor), actor(editor), elementId, existsFor(editor), ballotsFor(editor, session.anonymous))) afterSealedChange(editor);
}

export function start(editor: Editor, opts: Omit<SessionOptions, 'id'>): void {
  if (!editor.can('editor')) return;
  // Sealed ballots of a session that was cleared before it ended: never revealed, now dropped.
  editor.discardPrivate(COLLECTION);
  // One update for everyone: old ballots disappear together with the new session appearing.
  editor.transact(() => {
    startSession(store(editor), { ...opts, id: nanoid(10) }, actor(editor), Date.now());
  });
}

export function end(editor: Editor): void {
  if (!editor.can('editor')) return;
  const session = getSession(store(editor));
  // The server moves every voter's sealed ballot into the shared collection (replacing the
  // markers) before the session reads as ended: results never show half the votes.
  if (session?.active && session.anonymous) editor.revealPrivate(COLLECTION, { prefix: `${session.id}:` });
  endSession(store(editor), Date.now());
  editor.openDock(RESULTS_PANEL_ID);
}

export function clear(editor: Editor): void {
  if (!editor.can('editor')) return;
  editor.discardPrivate(COLLECTION);
  editor.transact(() => clearSession(store(editor)));
  if (editor.getDock() === RESULTS_PANEL_ID) editor.openDock(null);
}
