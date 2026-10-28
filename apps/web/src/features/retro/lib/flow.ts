// Retro mode (KAI-159): a guided retrospective composed from features that already exist. The
// `retro` collection holds only where the flow is (key 'session'); every step asks the owning
// feature to act through its command — private mode, the timer, facilitator controls, voting,
// clustering, templates — and never writes their data. Their guarantees come along: during
// writing nobody's browser receives another participant's stickies (private layers), votes stay
// sealed until the vote ends, and the facilitator's limits are enforced by the server.
import { FACILITATION_COLLECTION, FACILITATION_KEY } from '@freero/shared';
import type { Editor } from '@engine';

export type RetroPhase = 'write' | 'group' | 'vote' | 'discuss' | 'act';

export const PHASES: Array<{ id: RetroPhase; label: string; hint: string; next?: string }> = [
  { id: 'write', label: 'Write', hint: 'Add stickies on your own: nobody sees them until they are revealed.', next: 'Reveal and group' },
  { id: 'group', label: 'Group', hint: 'Read everything, then move similar stickies together.', next: 'Start voting' },
  { id: 'vote', label: 'Vote', hint: 'Vote on what to talk about. Votes stay hidden until the end.', next: 'Show results' },
  { id: 'discuss', label: 'Discuss', hint: 'Talk through the topics with the most votes, top first.', next: 'Agree on actions' },
  { id: 'act', label: 'Act', hint: 'Turn what you agreed into action items, each with an owner.' },
];

export const RETRO_COLLECTION = 'retro';
const KEY = 'session';
export const START_DIALOG_ID = 'retro.start';

export interface RetroSession {
  phase: RetroPhase;
  startedBy: string;
  startedByName: string;
  startedAt: number;
  votes: number;
  /** The retro started the facilitator controls (and ends them with itself). */
  facilitated: boolean;
  /** Action item cards added in the "act" step. */
  actionIds: string[];
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
  { id: 'retro-start-stop-continue', label: 'Start, stop, continue' },
  { id: 'retrospective', label: 'Went well, to improve, actions' },
  { id: 'retro-4ls', label: 'Liked, learned, lacked, longed for' },
  { id: null, label: 'Use what is on the board' },
];

const store = (editor: Pick<Editor, 'collection'>) => editor.collection<RetroSession>(RETRO_COLLECTION);

export function readSession(v: unknown): RetroSession | undefined {
  const s = v as Partial<RetroSession> | undefined;
  if (!s || typeof s.startedBy !== 'string' || !PHASES.some((p) => p.id === s.phase)) return undefined;
  return { ...s, actionIds: Array.isArray(s.actionIds) ? s.actionIds : [] } as RetroSession;
}

export const getSession = (editor: Pick<Editor, 'collection'>) => readSession(store(editor).get(KEY));

/** The facilitator moves the retro along (and the board owner may). */
export function canManage(editor: Editor, s: RetroSession): boolean {
  return editor.can('editor') && (s.startedBy === editor.user.id || editor.getRole() === 'owner');
}

/** Someone runs facilitator controls (read from the facilitation feature's collection). */
const facilitationRuns = (editor: Editor) => editor.collection(FACILITATION_COLLECTION).get(FACILITATION_KEY) !== undefined;

export function start(editor: Editor, opts: RetroOptions): void {
  if (!editor.can('editor') || getSession(editor)) return;
  if (opts.template) editor.runCommand('templates.insert', { id: opts.template });
  // Limit participants to stickies while they write, unless someone already facilitates.
  const before = facilitationRuns(editor);
  if (opts.stickiesOnly && !before) editor.runCommand('facilitation.start', { allowedTypes: ['sticky'] });
  const startsControls = !before && facilitationRuns(editor);
  editor.runCommand('private-mode.start');
  editor.runCommand('timer.start', { minutes: opts.minutes });
  store(editor).set(KEY, {
    phase: 'write',
    startedBy: editor.user.id,
    startedByName: editor.user.name,
    startedAt: editor.host.serverNow(),
    votes: opts.votes,
    facilitated: startsControls,
    actionIds: [],
  });
}

/** Moves to the next step, asking each feature to do its part. */
export function advance(editor: Editor): void {
  const s = getSession(editor);
  if (!s || !canManage(editor, s)) return;
  const i = PHASES.findIndex((p) => p.id === s.phase);
  const next = PHASES[i + 1]?.id;
  if (!next) return;
  switch (next) {
    case 'group':
      editor.runCommand('private-mode.reveal');
      break;
    case 'vote':
      editor.runCommand('voting.start', { votesPerUser: s.votes, hideResults: true, title: 'What should we talk about?' });
      break;
    case 'discuss':
      editor.runCommand('voting.end');
      break;
    case 'act':
      if (s.facilitated) editor.runCommand('facilitation.set', { allowedTypes: ['sticky', 'card'] });
      break;
  }
  store(editor).set(KEY, { ...s, phase: next });
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
  if (s.phase === 'write') editor.runCommand('private-mode.reveal');
  if (s.phase === 'vote') editor.runCommand('voting.end');
  if (s.facilitated) editor.runCommand('facilitation.end');
  store(editor).delete(KEY);
}
