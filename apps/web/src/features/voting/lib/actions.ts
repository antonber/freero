// Editor-bound voting actions (shared by panels and commands). Only the voting feature's scoped
// editor may call these: the `voting` collection is owned by this feature.
//
// Who votes: owners, editors, and participants (commenters and guests while the board lets them
// take part: Editor.isParticipant) — the server holds everyone to their own ballot. Who runs a
// vote (start, end, clear, the history): owners and editors.
import { nanoid } from 'nanoid';
import { deadlineClock, type Editor } from '@engine';
import {
  ballotKey,
  castVote,
  clearSession,
  countedVotes,
  endSession,
  forgetPast,
  getSession,
  isEligible,
  isOpen,
  retractVote,
  startSession,
  syncSealedMarker,
  whyNoVote,
  type Ballot,
  type SessionOptions,
  type VotingValue,
} from './voting';
import { RESULTS_PANEL_ID } from './state';

import { t } from '../messages';
const COLLECTION = 'voting';
const store = (editor: Editor) => editor.collection<VotingValue>(COLLECTION);
/** This user's sealed ballots (hidden results): the server shows them to nobody until revealed. */
const sealed = (editor: Editor) => editor.privateCollection<VotingValue>(COLLECTION);
const actor = (editor: Editor) => ({ id: editor.user.id, name: editor.user.name, color: editor.user.color });
/** May this user cast a ballot (the server's rule: votingRules.ts)? */
export const mayVote = (editor: Editor) => editor.can('editor') || editor.isParticipant();

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
  const now = editor.host.serverNow();
  if (!session?.active || !mayVote(editor)) return;
  if (!isOpen(session, now)) return editor.host.notify(t('timeSUpThisVote'), 'info');
  const ballots = ballotsFor(editor, session.anonymous);
  if (castVote(s, actor(editor), elementId, existsFor(editor), ballots, now)) return afterSealedChange(editor);
  const current = countedVotes(ballots.get(ballotKey(session.id, editor.user.id)) as Ballot | undefined, session, existsFor(editor));
  if (whyNoVote(session, current, elementId) === 'item')
    editor.host.notify(t('atMostMaxperitemOfYour', { maxPerItem: session.maxPerItem }), 'info');
  else editor.host.notify(t('youVeUsedAllVotesperuser', { votesPerUser: session.votesPerUser }), 'info');
}

export function unvote(editor: Editor, elementId: string): void {
  const session = getSession(store(editor));
  if (!session || !mayVote(editor)) return;
  if (retractVote(store(editor), actor(editor), elementId, existsFor(editor), ballotsFor(editor, session.anonymous), editor.host.serverNow())) afterSealedChange(editor);
}

export function start(editor: Editor, opts: Omit<SessionOptions, 'id'>): void {
  if (!editor.can('editor')) return;
  // A vote's timer is enforced by the server on its clock (FAC-9): never set in an unmeasured one.
  const now = opts.durationMs ? deadlineClock(editor.host) : editor.host.serverNow();
  if (now === null) return editor.host.notify(t('clockNotSyncedYet'), 'info');
  // Sealed ballots of a session that was cleared before it ended: never revealed, now dropped.
  editor.discardPrivate(COLLECTION);
  const exists = (id: string) => !!editor.getElement(id);
  // One update for everyone: old ballots disappear together with the new session appearing (the
  // ended vote's totals stay in the history).
  editor.transact(() => {
    startSession(store(editor), { ...opts, id: nanoid(10) }, actor(editor), now, exists);
  });
}

/** Ends the running vote (only the vote `id`, when given: another feature ends the vote it started). */
export function end(editor: Editor, id?: string): void {
  if (!editor.can('editor')) return;
  const session = getSession(store(editor));
  if (!session?.active || (id !== undefined && session.id !== id)) return;
  // The server moves every voter's sealed ballot into the shared collection (replacing the
  // markers; without names in an anonymous vote) before the session reads as ended: results never
  // show half the votes. One step with the end: offline, both wait together (FAC-8: the store sends
  // the reveal first on reconnecting, and keeps it with the device copy until then).
  editor.transact(() => {
    if (session.anonymous) editor.revealPrivate(COLLECTION, { prefix: `${session.id}:` });
    endSession(store(editor), editor.host.serverNow());
  });
  editor.openDock(RESULTS_PANEL_ID);
}

/**
 * The vote's timer ran out: the starter's client ends it, or every editor's when the starter has
 * left — the server has stopped taking ballots already (votingRules.ts).
 * Several clients ending it at once reveal the same ballots: the result is the same.
 */
export function endWhenTimeIsUp(editor: Editor, onBoard: (userId: string) => boolean): void {
  const session = getSession(store(editor));
  if (!session?.active || !editor.can('editor') || isOpen(session, editor.host.serverNow())) return;
  if (session.startedBy === editor.user.id || !onBoard(session.startedBy)) end(editor);
}

export function clear(editor: Editor): void {
  if (!editor.can('editor')) return;
  editor.discardPrivate(COLLECTION);
  const exists = (id: string) => !!editor.getElement(id);
  editor.transact(() => clearSession(store(editor), exists, editor.host.serverNow()));
  if (editor.getDock() === RESULTS_PANEL_ID) editor.openDock(null);
}

/** Removes a past vote from the history. */
export function forget(editor: Editor, sessionId: string): void {
  if (!editor.can('editor')) return;
  forgetPast(store(editor), sessionId);
}
