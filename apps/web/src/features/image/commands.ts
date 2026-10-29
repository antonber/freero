import { Crop, Undo2 } from 'lucide-react';
import type { ImageElement } from '@freero/shared';
import { defineCommands, type Editor } from '@engine';
import { resetCrop } from './lib/crop';
import { insertStoredImages } from './lib/insert';
import { CROP_PANEL } from './lib/cropping';

const selectedImages = (editor: Editor) =>
  editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is ImageElement => el?.type === 'image' && !el.locked);

export default defineCommands([
  {
    id: 'image.crop',
    icon: Crop,
    label: 'Crop image',
    menus: ['context'],
    when: (editor) => {
      const [img, ...rest] = selectedImages(editor);
      return !!img && !rest.length && editor.getSelection().length === 1 && !!img.src && img.naturalW > 0;
    },
    run(editor) {
      editor.openPanel(CROP_PANEL, { id: selectedImages(editor)[0].id });
    },
  },
  {
    // Images already in Freero's storage, placed by another feature (share: pictures shared into the
    // installed app, KAI-218). Args: { urls: string[] } of `/uploads/<name>`; anything else is ignored.
    id: 'image.insertStored',
    label: 'Insert stored images',
    run(editor, args) {
      const urls = (args as { urls?: unknown } | undefined)?.urls;
      if (Array.isArray(urls)) void insertStoredImages(editor, urls.filter((u): u is string => typeof u === 'string'));
    },
  },
  {
    id: 'image.resetCrop',
    icon: Undo2,
    label: 'Reset crop',
    menus: ['context'],
    when: (editor) => selectedImages(editor).some((el) => !!el.crop),
    run(editor) {
      editor.updateMany(selectedImages(editor).filter((el) => el.crop).map((el) => ({ id: el.id, patch: resetCrop(el) })));
    },
  },
]);
