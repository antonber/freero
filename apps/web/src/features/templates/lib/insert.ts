// Inserting a template into the live board: one transaction (= one undo step), then select
// the top-level elements and glide the camera to them.
import { nanoid } from 'nanoid';
import type { FrameElement } from '@freero/shared';
import type { Editor } from '@engine';
import { instantiate } from './place';
import type { TemplateDef } from './types';

export const DOCK_ID = 'templates';

export function insertTemplate(editor: Editor, def: TemplateDef): string[] {
  if (!editor.can('editor')) {
    editor.host.notify('You need edit access to add templates.', 'info');
    return [];
  }
  const frames = editor.getElements().filter((e): e is FrameElement => e.type === 'frame');
  const els = instantiate(
    def,
    {
      content: editor.getBounds(),
      viewportCenter: editor.getViewportCenter(),
      maxFrameIndex: frames.reduce((m, f) => Math.max(m, f.index ?? 0), -1),
    },
    () => nanoid(),
  );
  let ids: string[] = [];
  editor.transact(() => {
    ids = editor.createMany(els);
  });
  if (!ids.length) return [];
  const top = els.filter((e) => !e.frameId).map((e) => e.id!);
  editor.select(top);
  editor.zoomToFit(ids, { animate: true, padding: 96 });
  return ids;
}
