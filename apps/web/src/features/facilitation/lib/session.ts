// The facilitation session (`facilitation` collection, key 'session' -> FacilitationSession from
// @freero/shared). The SERVER reads it and enforces the lock and the allowed types
// (apps/server/src/modules/realtime/facilitation.ts); this client only writes it and applies the
// two parts that are views (following the facilitator, hidden cursors).
import { create } from 'zustand';
import { FACILITATION_COLLECTION, FACILITATION_KEY, type ElementType, type FacilitationSession } from '@freero/shared';
import type { Editor } from '@engine';

export type SessionPatch = Partial<Pick<FacilitationSession, 'locked' | 'allowedTypes' | 'follow' | 'cursorsHidden'>>;

const store = (editor: Pick<Editor, 'collection'>) => editor.collection<FacilitationSession>(FACILITATION_COLLECTION);

/** The running session (a malformed value reads as none, as on the server). */
export function readSession(v: unknown): FacilitationSession | undefined {
  const s = v as Partial<FacilitationSession> | undefined;
  if (!s || typeof s.by !== 'string' || typeof s.byName !== 'string') return undefined;
  return {
    by: s.by,
    byName: s.byName,
    startedAt: typeof s.startedAt === 'number' ? s.startedAt : 0,
    locked: s.locked === true,
    allowedTypes: Array.isArray(s.allowedTypes) ? s.allowedTypes.filter((t) => typeof t === 'string') : null,
    follow: s.follow === true,
    cursorsHidden: s.cursorsHidden === true,
  };
}

export const getSession = (editor: Pick<Editor, 'collection'>) => readSession(store(editor).get(FACILITATION_KEY));

/** The facilitator runs it; the board owner may too (the server allows exactly these two). */
export function canManage(editor: Editor, s: FacilitationSession): boolean {
  return editor.can('editor') && (s.by === editor.user.id || editor.getRole() === 'owner');
}

export function start(editor: Editor, patch: SessionPatch = {}): void {
  if (!editor.can('editor') || getSession(editor)) return;
  const session: FacilitationSession = {
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

export function change(editor: Editor, patch: SessionPatch): void {
  const s = getSession(editor);
  if (!s || !canManage(editor, s)) return;
  store(editor).set(FACILITATION_KEY, { ...s, ...patch });
}

export function end(editor: Editor): void {
  const s = getSession(editor);
  if (!s || !canManage(editor, s)) return;
  store(editor).delete(FACILITATION_KEY);
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
