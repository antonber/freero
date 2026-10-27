import type { ShapeElement } from '@freero/shared';
import { defineFormat } from '@engine';
import { Divider } from '@ui';
import {
  AlignControl,
  BorderControl,
  FillControl,
  FontFamilyControl,
  FontSizeControl,
  KindControl,
  TextColorControl,
  TextStyleButtons,
} from './lib/controls';

export default defineFormat({
  id: 'shape.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'shape'),
  Component: ({ editor, selection }) => {
    const shapes = selection as ShapeElement[];
    return (
      <>
        <KindControl editor={editor} shapes={shapes} />
        <FillControl editor={editor} shapes={shapes} />
        <BorderControl editor={editor} shapes={shapes} />
        <Divider vertical />
        <FontFamilyControl editor={editor} shapes={shapes} />
        <FontSizeControl editor={editor} shapes={shapes} />
        <TextColorControl editor={editor} shapes={shapes} />
        <TextStyleButtons editor={editor} />
        <AlignControl editor={editor} shapes={shapes} />
      </>
    );
  },
});
