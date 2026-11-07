// Private mode's shared state (the `privateMode` collection, key 'session') and its actions.
// What participants add while it is on goes to their PRIVATE layer (Editor.setPrivatePlacement),
// which the server sends to nobody else; revealing asks the server to move everyone's private
// elements into the shared board at once (Editor.revealPrivate), then ends the session.
//
// Anonymous (#44): the facilitator can make a session anonymous (the bar says so to everyone) —
// the server then reveals the drafts with no author. It is the SERVER that keeps it: it stamps
// drafts written while the session is anonymous (realtime attribution.ts), so switching it off or
// ending the session never names them. That is why an ended session stays in the collection as
// `active: false` (the next start replaces it): drafts still on their way at the reveal, shared
// later from the leftover bar, are anonymous too.
//
// Participants (commenters and guests while the board lets them, Editor.isParticipant) draft too:
// the same rule places what they add, and the server takes from them only drafts of
// PRIVATE_MODE_TYPES while a session runs (realtime participation.ts).
//
// Each session has an id (FAC-1), and its end is kept as a tombstone under `ended:<id>` too
// (@freero/shared sessions.ts): an "Anonymous" switched at the same moment as the reveal, or
// offline, can't make an ended session active again. The reveal and the end are one step, and a
// reveal that waits offline is tied to its session (FAC-8: it never reveals a later one's drafts).
import { nanoid } from 'nanoid';
import {
  liveSession,
  PRIVATE_MODE_COLLECTION,
  PRIVATE_MODE_KEY,
  PRIVATE_MODE_TYPES,
  sessionValue,
  writeSessionEnd,
  type BoardElement,
  type ElementType,
  type PrivateModeSession,
} from '@freero/shared';
import type { Editor } from '@engine';

import { t } from '../messages';
export const COLLECTION = PRIVATE_MODE_COLLECTION;
const KEY = PRIVATE_MODE_KEY;

/**
 * What goes private while the mode is on: content whose whole text lives in the element itself.
 * Not frames (containers) and not tables (their cells live in a shared collection).
 */
export const PRIVATE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(PRIVATE_MODE_TYPES);

/** The running session, from a getter over the collection (none once it ended, whatever was written since). */
export function runningSession(get: (key: string) => unknown): PrivateModeSession | undefined {
  const s = liveSession(get, KEY) as PrivateModeSession | undefined;
  return s && s.active ? s : undefined;
}

export const getSession = (editor: Pick<Editor, 'collection'>): PrivateModeSession | undefined =>
  runningSession((k) => editor.collection<PrivateModeSession>(COLLECTION).get(k));

/** The running session, else the one that ran last (ended: its leftovers keep its anonymity). */
const lastSession = (editor: Pick<Editor, 'collection'>): PrivateModeSession | undefined =>
  sessionValue((k) => editor.collection<PrivateModeSession>(COLLECTION).get(k), KEY) as PrivateModeSession | undefined;

/** May this user reveal / end it from the bar (the starter or the owner; any editor via the board menu). */
export function canManage(editor: Editor, s: PrivateModeSession): boolean {
  return editor.can('editor') && (s.startedBy === editor.user.id || editor.getRole() === 'owner');
}

/**
 * The placement rule for one session: matching new elements go private; with a frame scope, only
 * those whose center is inside that frame (frames are never rotated).
 */
export function privateRule(editor: Pick<Editor, 'getElement'>, s: PrivateModeSession): (el: BoardElement) => boolean {
  return (el) => {
    if (!PRIVATE_TYPES.has(el.type)) return false;
    if (!s.frameId) return true;
    const f = editor.getElement(s.frameId);
    if (!f) return false;
    const cx = el.x + el.w / 2;
    const cy = el.y + el.h / 2;
    return cx >= f.x && cx <= f.x + f.w && cy >= f.y && cy <= f.y + f.h;
  };
}

/** The one frame selected, if any (to scope private mode to it). */
export function selectedFrame(editor: Editor): BoardElement | undefined {
  const sel = editor.getSelection();
  const el = sel.length === 1 ? editor.getElement(sel[0]) : undefined;
  return el?.type === 'frame' ? el : undefined;
}

export function start(editor: Editor, frameId: string | null, opts: { anonymous?: boolean } = {}): void {
  if (!editor.can('editor') || getSession(editor)) return;
  const session: PrivateModeSession = {
    id: nanoid(10),
    active: true,
    startedBy: editor.user.id,
    startedByName: editor.user.name,
    startedAt: editor.host.serverNow(),
    frameId,
    ...(opts.anonymous ? { anonymous: true } : {}),
  };
  editor.collection<PrivateModeSession>(COLLECTION).set(KEY, session);
}

/**
 * Makes the running session anonymous or not (the facilitator; everyone's bar says which). Drafts
 * written while it was anonymous stay anonymous after it is switched off (see the header).
 */
export function setAnonymous(editor: Editor, anonymous: boolean): void {
  const s = getSession(editor);
  if (!s || !canManage(editor, s) || !!s.anonymous === anonymous) return;
  const { anonymous: _was, ...rest } = s;
  editor.collection<PrivateModeSession>(COLLECTION).set(KEY, anonymous ? { ...rest, anonymous: true } : rest);
}

/** Shares this user's own leftover private items (private mode already ended). */
export function shareLeftovers(editor: Editor): void {
  if (!editor.can('editor')) return;
  editor.revealPrivate('elements', { mine: true, anonymous: !!lastSession(editor)?.anonymous });
}

/**
 * Reveals everyone's private content at once (on the server, authors online or not) and ends —
 * only the session `id`, when given (another feature ends the session it started).
 */
export function revealAndEnd(editor: Editor, id?: string): void {
  const s = getSession(editor);
  if (!editor.can('editor') || !s || (id !== undefined && s.id !== id)) return;
  const store = editor.collection<PrivateModeSession>(COLLECTION);
  editor.transact(() => {
    editor.revealPrivate('elements', { anonymous: !!s.anonymous, ...(s.id ? { session: { collection: COLLECTION, key: KEY, id: s.id } } : {}) });
    // Ended, kept for its anonymity (see the header); a session from before ids has no marker to keep.
    if (s.id) writeSessionEnd(store, KEY, { ...s, id: s.id, active: false, ended: true }, { keep: true });
    else store.set(KEY, { ...s, active: false });
  });
  editor.host.notify(s.anonymous ? t('privateContentRevealedToEveryone') : t('privateContentRevealedToEveryone2'), 'success');
}
