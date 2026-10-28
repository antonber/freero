import { Crop, Undo2 } from 'lucide-react';
import type { ImageElement } from '@freero/shared';
import { defineCommands, type Editor } from '@engine';
import { resetCrop } from './lib/crop';
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
