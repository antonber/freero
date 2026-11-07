// Retro mode (KAI-159): a guided retrospective composed from features that already exist. The
// `retro` collection holds only where the flow is (key 'session'); every step asks the owning
// feature to act through its command — private mode, the timer, facilitator controls, voting,
// clustering, templates — and never writes their data. Their guarantees come along: during
// writing nobody's browser receives another participant's stickies (private layers), votes stay
// sealed until the vote ends, and the facilitator's limits are enforced by the server.
//
// The retro acts only on the sessions it started (FAC-4): it remembers their ids (its private-mode
// session, its vote, its facilitator controls) and asks those features to end exactly them. A
// vote or a private mode someone else is running is never adopted: the retro says so and waits.
//
// Its own session is one whole value (FAC-1): each retro has an id and Finish / End is kept as a
// tombstone under `ended:<id>` (@freero/shared sessions.ts), so an action item added or a step
// taken at the same moment, or offline, never brings a finished retro back. A step is a
// compare-and-set on the step it was asked from (FAC-3): asked twice, it moves once.
import { nanoid } from 'nanoid';
import {
  FACILITATION_COLLECTION,
  FACILITATION_KEY,
  PRIVATE_MODE_COLLECTION,
  PRIVATE_MODE_KEY,
  VOTING_COLLECTION,
  VOTING_SESSION_KEY,
  liveSession,
  sessionIdOf,
  writeSessionEnd,
} from '@freero/shared';
import type { Editor } from '@engine';

import { t } from '../messages';
export type RetroPhase = 'write' | 'group' | 'vote' | 'discuss' | 'act';

export const PHASES: Array<{ id: RetroPhase; label: string; hint: string; next?: string }> = [
  { id: 'write', label: t('write'), hint: t('addStickiesOnYourOwn'), next: t('revealAndGroup') },
  { id: 'group', label: t('group'), hint: t('readEverythingThenMoveSimilar'), next: t('startVoting') },
  { id: 'vote', label: t('vote'), hint: t('voteOnWhatToTalk'), next: t('showResults') },
  { id: 'discuss', label: t('discuss'), hint: t('talkThroughTheTopicsWith'), next: t('agreeOnActions') },
  { id: 'act', label: t('act'), hint: t('turnWhatYouAgreedInto') },
];

export const RETRO_COLLECTION = 'retro';
const KEY = 'session';
export const START_DIALOG_ID = 'retro.start';

export interface RetroSession {
  /** [additive, FAC-1] This retro (its end is kept under `ended:<id>`). Absent: written before ids. */
  id?: string;
  phase: RetroPhase;
  startedBy: string;
  startedByName: string;
  startedAt: number;
  votes: number;
  /** The retro started the facilitator controls (and ends them with itself). */
  facilitated: boolean;
  /** Action item cards added in the "act" step. */
  actionIds: string[];
  /** [additive, FAC-4] The private-mode session the retro started (it reveals only that one). */
  privateModeId?: string | null;
  /** [additive, FAC-4] The vote the retro started (it ends only that one). */
  voteId?: string | null;
  /** [additive, FAC-4] The facilitator controls the retro started. */
  facilitationId?: string | null;
}

export interface RetroOptions {
  /** Built-in template to lay out the board with (null: use the board as it is). */
  template: string | null;
  minutes: number;
  votes: number;
  /** Participants may only add stickies while writing (facilitator controls). */
  stickiesOnly: boolean;
}

export const FORMATS: Array<{ id: string | null; label: string }> = [
  { id: 'retro-start-stop-continue', label: t('startStopContinue') },
  { id: 'retrospective', label: t('wentWellToImproveActions') },
  { id: 'retro-4ls', label: t('likedLearnedLackedLongedFor') },
  { id: null, label: t('useWhatIsOnThe') },
];

const store = (editor: Pick<Editor, 'collection'>) => editor.collection<RetroSession>(RETRO_COLLECTION);

export function readSession(v: unknown): RetroSession | undefined {
  const s = v as Partial<RetroSession> | undefined;
  if (!s || typeof s.startedBy !== 'string' || !PHASES.some((p) => p.id === s.phase)) return undefined;
  return { ...s, actionIds: Array.isArray(s.actionIds) ? s.actionIds : [] } as RetroSession;
}

/** The running retro, read from the collection's entries or a getter (none once it was finished). */
export const sessionOf = (get: (key: string) => unknown) => readSession(liveSession(get, KEY));
export const getSession = (editor: Pick<Editor, 'collection'>) => sessionOf((k) => store(editor).get(k));

/**
 * Its private mode / vote / facilitator controls as the commands take them: `{ id }` of the session
 * the retro started, null when it started none. A retro written before ids (no `id`) acts on
 * whichever session runs, as it used to (undefined: no id passed).
 */
const own = (s: RetroSession, id: string | null | undefined): Record<string, unknown> | null | undefined => (id ? { id } : s.id ? null : undefined);
function runOn(editor: Editor, command: string, target: Record<string, unknown> | null | undefined, args: Record<string, unknown> = {}): void {
  if (target !== null) editor.runCommand(command, { ...args, ...target });
}

/** The facilitator moves the retro along (and the board owner may). */
export function canManage(editor: Editor, s: RetroSession): boolean {
  return editor.can('editor') && (s.startedBy === editor.user.id || editor.getRole() === 'owner');
}

/** The session another feature is running now (read from its collection), or undefined. */
const running = (editor: Pick<Editor, 'collection'>, collection: string, key: string) => {
  const c = editor.collection<unknown>(collection);
  return liveSession((k) => c.get(k), key) as Record<string, unknown> | undefined;
};
const facilitation = (editor: Editor) => running(editor, FACILITATION_COLLECTION, FACILITATION_KEY);
const privateMode = (editor: Editor) => {
  const s = running(editor, PRIVATE_MODE_COLLECTION, PRIVATE_MODE_KEY);
  return s?.active === true ? s : undefined;
};
const vote = (editor: Editor) => {
  const s = running(editor, VOTING_COLLECTION, VOTING_SESSION_KEY);
  return s?.active === true ? s : undefined;
};

/**
 * Runs another feature's command that starts a session and returns the id of the session it
 * started, or null when it started none (the command wasn't available, or nothing new appeared).
 */
function startedBy(editor: Editor, read: (editor: Editor) => Record<string, unknown> | undefined, command: string, args?: Record<string, unknown>): string | null {
  const before = sessionIdOf(read(editor));
  editor.runCommand(command, args);
  const after = read(editor);
  const id = sessionIdOf(after);
  return after && after.startedBy === editor.user.id && id !== before ? id : null;
}

export function start(editor: Editor, opts: RetroOptions): void {
  if (!editor.can('editor') || getSession(editor)) return;
  // Someone else's private mode would be revealed and ended by this retro's "group" step: say so.
  if (privateMode(editor)) return editor.host.notify(t('privateModeIsAlreadyRunning'), 'info');
  if (opts.template) editor.runCommand('templates.insert', { id: opts.template });
  // Limit participants to stickies while they write, unless someone already facilitates.
  let facilitationId: string | null = null;
  if (opts.stickiesOnly && !facilitation(editor)) {
    editor.runCommand('facilitation.start', { allowedTypes: ['sticky'] });
    const f = facilitation(editor);
    facilitationId = f && f.by === editor.user.id ? sessionIdOf(f) : null;
  }
  const privateModeId = startedBy(editor, privateMode, 'private-mode.start');
  editor.runCommand('timer.start', { minutes: opts.minutes });
  store(editor).set(KEY, {
    id: nanoid(10),
    phase: 'write',
    startedBy: editor.user.id,
    startedByName: editor.user.name,
    startedAt: editor.host.serverNow(),
    votes: opts.votes,
    facilitated: facilitationId !== null,
    actionIds: [],
    privateModeId,
    voteId: null,
    facilitationId,
  });
}

/**
 * Moves from step `from` to the next one, asking each feature to do its part. Nothing when the
 * retro is no longer at `from` (a second click, or someone else moved it already).
 */
export function advance(editor: Editor, from: RetroPhase): void {
  const s = getSession(editor);
  if (!s || s.phase !== from || !canManage(editor, s)) return;
  const i = PHASES.findIndex((p) => p.id === s.phase);
  const next = PHASES[i + 1]?.id;
  if (!next) return;
  let patch: Partial<RetroSession> = {};
  switch (next) {
    case 'group':
      runOn(editor, 'private-mode.reveal', own(s, s.privateModeId));
      editor.runCommand('timer.stop'); // writing is over: its countdown would only distract
      break;
    case 'vote': {
      // A vote nobody ended would become the retro's (wrong items, wrong budget) and be closed by it.
      const other = vote(editor);
      if (other) return editor.host.notify(t('aVoteIsAlreadyRunning', { title: String(other.title ?? '') }), 'info');
      const voteId = startedBy(editor, vote, 'voting.start', { votesPerUser: s.votes, hideResults: true, title: t('whatShouldWeTalkAbout') });
      if (!voteId) return; // the vote didn't start (the voting feature said why): stay on this step
      patch = { voteId };
      break;
    }
    case 'discuss':
      runOn(editor, 'voting.end', own(s, s.voteId));
      break;
    case 'act':
      if (s.facilitated) runOn(editor, 'facilitation.set', own(s, s.facilitationId), { allowedTypes: ['sticky', 'card'] });
      break;
  }
  store(editor).set(KEY, { ...s, ...patch, phase: next });
}

/** Group step: sort every sticky on the board into clusters by colour (the arrange feature). */
export function clusterAll(editor: Editor): void {
  const stickies = editor.getElements().filter((el) => el.type === 'sticky' && !editor.isViewHidden(el.id));
  if (stickies.length < 2) return;
  editor.select(stickies.map((s) => s.id));
  editor.runCommand('arrange.clusterByColor');
}

/** Act step: a new action item card, ready to type into. */
export function addAction(editor: Editor): void {
  const s = getSession(editor);
  if (!s || !editor.can('editor')) return;
  const size = { w: 320, h: 160 };
  const at = editor.findFreeSpot(size);
  const id = editor.create({ type: 'card', x: at.x, y: at.y, title: '', color: '#7c5cff' } as never, { select: true });
  if (!id) return;
  store(editor).set(KEY, { ...s, actionIds: [...s.actionIds, id] });
  editor.zoomToFit([id], { maxZoom: 1 });
  editor.startEditing(id);
}

export function end(editor: Editor): void {
  const s = getSession(editor);
  if (!s || !editor.can('editor')) return;
  if (s.phase === 'write') {
    runOn(editor, 'private-mode.reveal', own(s, s.privateModeId));
    editor.runCommand('timer.stop');
  }
  if (s.phase === 'vote') runOn(editor, 'voting.end', own(s, s.voteId));
  if (s.facilitated) runOn(editor, 'facilitation.end', own(s, s.facilitationId));
  // A retro from before ids has nothing to pin its end on: removed as it used to be.
  if (s.id) writeSessionEnd(store(editor), KEY, { id: s.id, ended: true }, { keep: true });
  else store(editor).delete(KEY);
}
