// The facilitation session (`facilitation` collection, key 'session' -> FacilitationSession from
// @freero/shared). The SERVER reads it and enforces the lock and the allowed types
// (apps/server/src/modules/realtime/facilitation.ts); this client only writes it and applies the
// two parts that are views (following the facilitator, hidden cursors).
//
// Each session has an id (FAC-1) and its end is kept under `ended:<id>` (@freero/shared sessions.ts),
// so an owner's change made at the same moment as the end, or offline, can't keep it running. The
// server holds the same rule (realtime sessionEnds.ts) and lets only the facilitator or the owner
// write that marker.
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import {
  FACILITATION_COLLECTION,
  FACILITATION_KEY,
  liveSession,
  PARTICIPATION_KEY,
  participationOpen,
  writeSessionEnd,
  type ElementType,
  type FacilitationSession,
  type ParticipationSetting,
} from '@freero/shared';
import type { Editor } from '@engine';

export type SessionPatch = Partial<Pick<FacilitationSession, 'locked' | 'allowedTypes' | 'follow' | 'cursorsHidden'>>;

const store = (editor: Pick<Editor, 'collection'>) => editor.collection<FacilitationSession>(FACILITATION_COLLECTION);

/** The running session (a malformed value reads as none, as on the server). */
export function readSession(v: unknown): FacilitationSession | undefined {
  const s = v as Partial<FacilitationSession> | undefined;
  if (!s || typeof s.by !== 'string' || typeof s.byName !== 'string') return undefined;
  return {
    ...(typeof s.id === 'string' && s.id ? { id: s.id } : {}),
    by: s.by,
    byName: s.byName,
    startedAt: typeof s.startedAt === 'number' ? s.startedAt : 0,
    locked: s.locked === true,
    allowedTypes: Array.isArray(s.allowedTypes) ? s.allowedTypes.filter((t) => typeof t === 'string') : null,
    follow: s.follow === true,
    cursorsHidden: s.cursorsHidden === true,
  };
}

/** The running session, from a getter over the collection (none once ended, whatever was written since). */
export const sessionOf = (get: (key: string) => unknown) => readSession(liveSession(get, FACILITATION_KEY));
export const getSession = (editor: Pick<Editor, 'collection'>) => sessionOf((k) => store(editor).get(k));

/** The facilitator runs it; the board owner may too (the server allows exactly these two). */
export function canManage(editor: Editor, s: FacilitationSession): boolean {
  return editor.can('editor') && (s.by === editor.user.id || editor.getRole() === 'owner');
}

export function start(editor: Editor, patch: SessionPatch = {}): void {
  if (!editor.can('editor') || getSession(editor)) return;
  const session: FacilitationSession = {
    id: nanoid(10),
    by: editor.user.id,
    byName: editor.user.name,
    startedAt: editor.host.serverNow(),
    locked: false,
    allowedTypes: null,
    follow: false,
    cursorsHidden: false,
    ...patch,
  };
  store(editor).set(FACILITATION_KEY, session);
}

/**
 * Is `s` the session `id` a caller started (any session when no id is given)? One without an id
 * counts: a client from before ids drops it when it changes the session.
 */
const isSession = (s: FacilitationSession, id: string | undefined) => id === undefined || !s.id || s.id === id;

/** Changes the running session (only the session `id`, when given: another feature changes the one it started). */
export function change(editor: Editor, patch: SessionPatch, id?: string): void {
  const s = getSession(editor);
  if (!s || !canManage(editor, s) || !isSession(s, id)) return;
  store(editor).set(FACILITATION_KEY, { ...s, ...patch });
}

/** Ends the running session (only the session `id`, when given). */
export function end(editor: Editor, id?: string): void {
  const s = getSession(editor);
  if (!s || !canManage(editor, s) || !isSession(s, id)) return;
  // The key itself is deleted (a server from before markers refuses anything else there); the
  // marker pins the end. A session from before ids is removed as it used to be.
  editor.transact(() => {
    if (s.id) writeSessionEnd(store(editor), FACILITATION_KEY, { id: s.id, ended: true });
    else store(editor).delete(FACILITATION_KEY);
  });
}

/** Validated `facilitation.set` / `facilitation.start` args (other features drive sessions). */
export function patchFromArgs(args: Record<string, unknown> | undefined): SessionPatch {
  const out: SessionPatch = {};
  if (!args) return out;
  if (typeof args.locked === 'boolean') out.locked = args.locked;
  if (typeof args.follow === 'boolean') out.follow = args.follow;
  if (typeof args.cursorsHidden === 'boolean') out.cursorsHidden = args.cursorsHidden;
  if (args.allowedTypes === null) out.allowedTypes = null;
  else if (Array.isArray(args.allowedTypes)) out.allowedTypes = args.allowedTypes.filter((t): t is ElementType => typeof t === 'string');
  return out;
}

// ---------------------------------------------------------------- participation (parity rank 1)
// Whether commenters and guests may take part in votes, planning poker and private mode (their own
// ballot, pick and drafts: @freero/shared participation.ts). Open unless switched off; the server
// reads it and lets the owner, the facilitator, or any editor while nobody facilitates change it.

export const isParticipationOpen = (editor: Pick<Editor, 'collection'>) => participationOpen(store(editor).get(PARTICIPATION_KEY));

/** May this user switch it (the server allows exactly these)? */
export function canSetParticipation(editor: Editor): boolean {
  if (!editor.can('editor')) return false;
  const s = getSession(editor);
  return editor.getRole() === 'owner' || !s || s.by === editor.user.id;
}

export function setParticipation(editor: Editor, open: boolean): void {
  if (!canSetParticipation(editor) || isParticipationOpen(editor) === open) return;
  const value: ParticipationSetting = { open, by: editor.user.id, at: editor.host.serverNow() };
  editor.collection<ParticipationSetting>(FACILITATION_COLLECTION).set(PARTICIPATION_KEY, value);
}

/** "Hide cursors" for myself (local, any role; remembered per browser). */
interface CursorPrefs {
  hideMine: boolean;
  setHideMine(v: boolean): void;
}
const PREF_KEY = 'freero.hideCursors';
function readPref(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) === '1';
  } catch {
    return false;
  }
}
export const useCursorPrefs = create<CursorPrefs>((set) => ({
  hideMine: readPref(),
  setHideMine(v) {
    try {
      localStorage.setItem(PREF_KEY, v ? '1' : '0');
    } catch {
      /* storage blocked: the setting lasts for this page */
    }
    set({ hideMine: v });
  },
}));

/** Are other people's cursors hidden for this user: their own choice, or the session's (participants). */
export function cursorsHiddenFor(userId: string, session: FacilitationSession | undefined, hideMine: boolean): boolean {
  return hideMine || (!!session?.cursorsHidden && session.by !== userId);
}
