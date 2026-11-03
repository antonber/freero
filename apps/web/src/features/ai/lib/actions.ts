// Shared bits of the AI feature: when its entry points show, what the selection offers, and how an
// accepted preview lands on the board (one undo step).
import { type AiActionResponse, type AiTask, type BoardElement } from '@freero/shared';
import type { Editor } from '@engine';

export const AI_DIALOG = 'ai.dialog';
export const CATCH_UP_DIALOG = 'ai.catch-up';

/** Kinds clustering sorts (the server moves these into groups; titles stay put). */
const CLUSTERABLE = new Set(['sticky', 'card']);

/** AI entry points show only when the server offered AI here and this person can edit. */
export const aiAvailable = (editor: Editor): boolean => !!editor.host.ai && (editor.getRole() === 'owner' || editor.getRole() === 'editor');

/**
 * Actions that explain themselves when AI is off for this person here (the server offers AI on this
 * instance, but not to them on this board): they show, and running them says why instead.
 */
export const aiOfferedHere = (editor: Editor): boolean => aiAvailable(editor) || !!editor.host.aiUnavailable;

/** Tells the person why AI can't run here; true when it can. */
export function aiOrExplain(editor: Editor): boolean {
  if (aiAvailable(editor)) return true;
  editor.host.notify(editor.host.aiUnavailable ?? 'AI actions add to the board, so they need edit access.', 'info');
  return false;
}

export const clusterable = (els: BoardElement[]) => els.filter((el) => CLUSTERABLE.has(el.type) && !el.locked);

export function selectedElements(editor: Editor): BoardElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el);
}

/** Opens the AI dialog on a task, with the current selection as its material. */
export function openAi(editor: Editor, task?: AiTask): void {
  editor.openPanel(AI_DIALOG, { ...(task ? { task } : {}), ids: editor.getSelection() });
}

/** The task a selection suggests: notes to sort, or something to summarise; nothing → ideas. */
export function suggestedTask(selection: BoardElement[]): AiTask {
  if (clusterable(selection).length >= 2 && clusterable(selection).length >= selection.length - 1) return 'cluster';
  return selection.length ? 'summarize' : 'ideas';
}

const boxOf = (els: Array<{ x: number; y: number; w: number; h: number }>) => {
  if (!els.length) return null;
  const x = Math.min(...els.map((e) => e.x));
  const y = Math.min(...els.map((e) => e.y));
  return { x, y, w: Math.max(...els.map((e) => e.x + e.w)) - x, h: Math.max(...els.map((e) => e.y + e.h)) - y };
};

/**
 * Inserts an accepted preview exactly where the server placed it — new elements through
 * `insertElements` (fresh ids, one undo step) and the existing notes it sorted moved like a drag —
 * in ONE transaction, so a single Ctrl+Z takes all of it back. Returns the new top-level ids.
 */
export function applyPreview(editor: Editor, res: AiActionResponse, opts: { into?: string } = {}): string[] {
  const snapshot = res.snapshot ?? { elements: [], content: {} };
  let created: string[] = [];
  editor.transact(() => {
    const b = boxOf(snapshot.elements);
    // Into a frame (a meeting's summary): the server placed it inside, or below what is there; the
    // frame grows first to hold it, so the drop rule makes it a member — all in this one step.
    const frame = opts.into ? editor.getElement(opts.into) : undefined;
    if (b && frame?.type === 'frame' && !frame.locked) {
      const pad = 32;
      const right = Math.max(frame.x + frame.w, b.x + b.w + pad);
      const bottom = Math.max(frame.y + frame.h, b.y + b.h + pad);
      if (right > frame.x + frame.w || bottom > frame.y + frame.h) editor.update(frame.id, { w: right - frame.x, h: bottom - frame.y });
    }
    if (b) created = editor.insertElements(snapshot, { at: { x: b.x + b.w / 2, y: b.y + b.h / 2 } });
    const moves = (res.moves ?? [])
      .map((m) => {
        const el = editor.getElement(m.id);
        return el && !el.locked ? { id: m.id, dx: m.x - el.x, dy: m.y - el.y } : null;
      })
      .filter((m): m is { id: string; dx: number; dy: number } => !!m && (m.dx !== 0 || m.dy !== 0));
    if (moves.length) editor.moveBy(moves);
  });
  const ids = [...created, ...(res.moves ?? []).map((m) => m.id)];
  if (ids.length) editor.select(ids);
  return created;
}
