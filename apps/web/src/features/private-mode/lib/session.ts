// Private mode's shared state (the `privateMode` collection, key 'session') and its actions.
// What participants add while it is on goes to their PRIVATE layer (Editor.setPrivatePlacement),
// which the server sends to nobody else; revealing asks the server to move everyone's private
// elements into the shared board at once (Editor.revealPrivate), then ends the session.
import type { BoardElement, ElementType, PrivateModeSession } from '@freero/shared';
import type { Editor } from '@engine';

export const COLLECTION = 'privateMode';
const KEY = 'session';

/**
 * What goes private while the mode is on: content whose whole text lives in the element itself.
 * Not frames (containers) and not tables (their cells live in a shared collection).
 */
export const PRIVATE_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(['sticky', 'shape', 'text', 'card', 'pen', 'emoji', 'image', 'connector']);

export function getSession(editor: Pick<Editor, 'collection'>): PrivateModeSession | undefined {
  const s = editor.collection<PrivateModeSession>(COLLECTION).get(KEY);
  return s && s.active ? s : undefined;
}

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

export function start(editor: Editor, frameId: string | null): void {
  if (!editor.can('editor') || getSession(editor)) return;
  const session: PrivateModeSession = {
    active: true,
    startedBy: editor.user.id,
    startedByName: editor.user.name,
    startedAt: editor.host.serverNow(),
    frameId,
  };
  editor.collection<PrivateModeSession>(COLLECTION).set(KEY, session);
}

/** Reveals everyone's private content at once (on the server, authors online or not) and ends. */
export function revealAndEnd(editor: Editor): void {
  if (!editor.can('editor') || !getSession(editor)) return;
  editor.revealPrivate('elements');
  editor.collection<PrivateModeSession>(COLLECTION).delete(KEY);
  editor.host.notify('Private content revealed to everyone', 'success');
}
