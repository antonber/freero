// Editor-bound voting actions (shared by panels and commands). Only the voting feature's scoped
// editor may call these: the `voting` collection is owned by this feature.
import { nanoid } from 'nanoid';
import type { Editor } from '@engine';
import {
  castVote,
  clearSession,
  endSession,
  getSession,
  isEligible,
  retractVote,
  startSession,
  type SessionOptions,
  type VotingValue,
} from './voting';
import { RESULTS_PANEL_ID } from './state';

const store = (editor: Editor) => editor.collection<VotingValue>('voting');
const actor = (editor: Editor) => ({ id: editor.user.id, name: editor.user.name, color: editor.user.color });

function existsFor(editor: Editor) {
  const session = getSession(store(editor));
  return (id: string) => {
    const el = editor.getElement(id);
    return !!el && !!session && isEligible(session, el);
  };
}

export function vote(editor: Editor, elementId: string): void {
  const s = store(editor);
  const session = getSession(s);
  if (!session?.active || !editor.can('editor')) return;
  if (!castVote(s, actor(editor), elementId, existsFor(editor)))
    editor.host.notify(`You've used all ${session.votesPerUser} of your votes. Remove one to vote again.`, 'info');
}

export function unvote(editor: Editor, elementId: string): void {
  if (!editor.can('editor')) return;
  retractVote(store(editor), actor(editor), elementId, existsFor(editor));
}

export function start(editor: Editor, opts: Omit<SessionOptions, 'id'>): void {
  if (!editor.can('editor')) return;
  // One update for everyone: old ballots disappear together with the new session appearing.
  editor.transact(() => {
    startSession(store(editor), { ...opts, id: nanoid(10) }, actor(editor), Date.now());
  });
}

export function end(editor: Editor): void {
  if (!editor.can('editor')) return;
  endSession(store(editor), Date.now());
  editor.openDock(RESULTS_PANEL_ID);
}

export function clear(editor: Editor): void {
  if (!editor.can('editor')) return;
  editor.transact(() => clearSession(store(editor)));
  if (editor.getDock() === RESULTS_PANEL_ID) editor.openDock(null);
}
