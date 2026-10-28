// Saved templates: a board or a selection the user saved through Host.saveTemplate, listed next
// to the built-in catalog and inserted through the engine's copy/paste path
// (Editor.insertElements: fresh ids, references remapped, copied content restored).
import type { FrameElement } from '@freero/shared';
import type { Editor, ElementsSnapshot, SavedTemplateInfo } from '@engine';

export const SAVE_DIALOG_ID = 'templates.save';

/** Longest side of the preview image saved with a template (px). */
const THUMB_MAX = 480;

// The panel's list refreshes when a save (from the dialog) or a delete happens in this tab.
const listeners = new Set<() => void>();
export function onSavedTemplatesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}
function savedTemplatesChanged(): void {
  for (const cb of listeners) cb();
}

/** Saved templates matching a free-text query (name + description). */
export function filterSaved(all: SavedTemplateInfo[], query: string): SavedTemplateInfo[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return all;
  return all.filter((t) => {
    const hay = `${t.name} ${t.description}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** Frames of the snapshot renumbered after the board's own (keeping their order), so presenting keeps the board's frames first. */
export function numberFramesAfter(snapshot: ElementsSnapshot, maxFrameIndex: number): ElementsSnapshot {
  let next = maxFrameIndex;
  const frames = snapshot.elements
    .filter((el): el is FrameElement => el.type === 'frame')
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const index = new Map(frames.map((f) => [f.id, ++next]));
  return { ...snapshot, elements: snapshot.elements.map((el) => (index.has(el.id) ? { ...el, index: index.get(el.id)! } : el)) };
}

const maxFrameIndexOf = (editor: Editor) =>
  editor.getElements().reduce((m, el) => (el.type === 'frame' ? Math.max(m, (el as FrameElement).index ?? 0) : m), -1);

/** A small JPEG of what is being saved, or null if it can't be drawn (never blocks saving). */
async function previewOf(editor: Editor, ids: string[] | undefined): Promise<string | null> {
  const b = editor.getBounds(ids, { visual: true });
  if (!b || b.w <= 0 || b.h <= 0) return null;
  try {
    const scale = Math.min(1, THUMB_MAX / Math.max(b.w, b.h));
    return await editor.renderToDataUrl({ ids, format: 'jpeg', scale, padding: 24, skipFonts: true });
  } catch {
    return null;
  }
}

/** The board (ids undefined) or the given items as a saved template. Rejects with a toast-ready message. */
export async function saveAsTemplate(
  editor: Editor,
  opts: { ids?: string[]; name: string; description: string; shareWithTeam?: boolean },
): Promise<SavedTemplateInfo> {
  const content = editor.exportElements(opts.ids);
  if (!content) throw new Error('There is nothing to save yet.');
  const thumbnail = await previewOf(editor, opts.ids);
  const saved = await editor.host.saveTemplate({
    name: opts.name,
    description: opts.description,
    thumbnail,
    content,
    ...(opts.shareWithTeam ? { shareWithTeam: true } : {}),
  });
  savedTemplatesChanged();
  return saved;
}

/** Shares one of the user's templates with the board's team (or makes it personal again). */
export async function setTemplateShared(editor: Editor, id: string, shared: boolean): Promise<void> {
  await editor.host.shareTemplate(id, shared);
  savedTemplatesChanged();
}

export async function deleteSavedTemplate(editor: Editor, id: string): Promise<void> {
  await editor.host.deleteTemplate(id);
  savedTemplatesChanged();
}

/**
 * Inserts a saved template on a free spot (one undo step), frames numbered after the board's,
 * then selects it and glides the camera there. Returns the top-level ids ([] if nothing).
 */
export async function insertSavedTemplate(editor: Editor, id: string): Promise<string[]> {
  if (!editor.can('editor')) {
    editor.host.notify('You need edit access to add templates.', 'info');
    return [];
  }
  const snapshot = await editor.host.loadTemplate(id);
  const top = editor.insertElements(numberFramesAfter(snapshot, maxFrameIndexOf(editor)));
  if (top.length) editor.zoomToFit(top, { animate: true, padding: 96 });
  return top;
}
