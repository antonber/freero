// Shared bits of the AI feature: when its entry points show, what the selection offers, and how an
// accepted preview lands on the board (one undo step).
import { layoutStructure, richTextToPlain, type AiActionResponse, type AiTask, type BoardElement } from '@freero/shared';
import type { Editor } from '@engine';

import { t } from '../messages';
export const AI_DIALOG = 'ai.dialog';
export const CATCH_UP_DIALOG = 'ai.catch-up';
/** The board assistant's dock (#1). */
export const ASSISTANT_DOCK = 'ai.assistant';

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
  editor.host.notify(editor.host.aiUnavailable ?? t('aiActionsAddToThe'), 'info');
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

/**
 * A meeting's summary written into the import layout's own "Summary" note (#148) instead of a new
 * one: the note keeps its title and what it said (the date, who came), the AI's summary follows,
 * and it grows to fit — what sits below it in the frame moves down and the frame grows with it.
 * ONE transaction (one undo step). False when that note is gone or locked (then insert the preview).
 */
export function fillNote(editor: Editor, res: AiActionResponse, noteId: string, frameId: string): boolean {
  const note = editor.getElement(noteId) as (BoardElement & { text?: string }) | undefined;
  const frame = editor.getElement(frameId);
  const made = res.snapshot?.elements.find((el) => typeof (el as { text?: unknown }).text === 'string') as (BoardElement & { text: string }) | undefined;
  if (!note || note.locked || typeof note.text !== 'string' || !frame || frame.type !== 'frame' || !made) return false;
  const lines = (html: string) => richTextToPlain(html).split('\n');
  // What the note said, without its "Summary" title; the AI's note without its own title.
  const had = lines(note.text).slice(1).join('\n').trim();
  const said = lines(made.text).slice(1).join('\n').trim();
  const laid = layoutStructure({ kind: 'note', title: t('summary'), text: [had, said].filter(Boolean).join('\n\n') }, { newId: () => noteId });
  const next = laid.elements[0] as unknown as { text: string; h: number };
  const grow = Math.max(0, Math.round(next.h - note.h));
  const bottom = note.y + note.h;
  editor.transact(() => {
    if (grow) {
      const below = editor
        .getElements()
        .filter((el) => el.frameId === frameId && el.id !== noteId && el.y >= bottom - 1)
        .map((el) => ({ id: el.id, dx: 0, dy: grow }));
      if (!frame.locked) editor.update(frameId, { h: frame.h + grow });
      if (below.length) editor.moveBy(below);
    }
    editor.update(noteId, { text: next.text, ...(grow ? { h: note.h + grow } : {}) } as never);
  });
  editor.select([noteId]);
  return true;
}
