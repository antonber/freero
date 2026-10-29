// Inserting a template into the live board: one transaction (= one undo step), then select
// the top-level elements and glide the camera to them.
import { nanoid } from 'nanoid';
import type { BoardElement, FrameElement } from '@freero/shared';
import type { Editor } from '@engine';
import { boundsOf, instantiate } from './place';
import type { TemplateDef } from './types';

export const DOCK_ID = 'templates';

/**
 * Inserts a template, first loading its content when it lives in a chunk of its own (spec
 * templates). Templates without `load` are inserted before this returns, as `insertTemplate` does.
 */
export async function addTemplate(editor: Editor, def: TemplateDef): Promise<string[]> {
  if (def.load) await def.load();
  return insertTemplate(editor, def);
}

/** Inserts a template whose content is at hand (no `load`, or after it resolved). */
export function insertTemplate(editor: Editor, def: TemplateDef): string[] {
  if (!editor.can('editor')) {
    editor.host.notify('You need edit access to add templates.', 'info');
    return [];
  }
  const frames = editor.getElements().filter((e): e is FrameElement => e.type === 'frame');
  const { elements, content } = instantiate(
    def,
    {
      place: (size) => editor.findFreeSpot(size),
      maxFrameIndex: frames.reduce((m, f) => Math.max(m, f.index ?? 0), -1),
    },
    () => nanoid(),
  );
  // Elements whose content lives outside the elements map (table cells, owned by the table
  // feature) go through the engine's one path for copied content, `insertElements`, which hands
  // that content to the owner's `pasteContent`. Everything else is created normally, so each
  // element's `normalize` (text measuring) runs. Centering the group on its own center keeps
  // their positions; the drop rule puts them back into the template's frame.
  const withContent = elements.filter((e) => e.id! in content);
  const plain = elements.filter((e) => !(e.id! in content));
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(plain);
    const b = boundsOf(withContent);
    if (b) {
      const snapshot = withContent.map((el) => ({ rotation: 0, z: 0, createdBy: '', createdAt: 0, updatedAt: 0, ...el, frameId: null }) as BoardElement);
      ids.push(...editor.insertElements({ elements: snapshot, content }, { at: { x: b.x + b.w / 2, y: b.y + b.h / 2 } }));
    }
  });
  if (!ids.length) return [];
  const top = elements.filter((e) => !e.frameId).map((e) => e.id!);
  editor.select(top);
  editor.zoomToFit(ids, { animate: true, padding: 96 });
  return ids;
}
