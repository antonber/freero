import type { ShapeElement } from '@freero/shared';
import {
  FontFamilyControl,
  FontSizeControl,
  TextAlignControl,
  TextColorControl,
  TextMarkButtons,
  commonValue,
  defineFormat,
} from '@engine';
import { Divider } from '@ui';
import { FONT_SIZES } from './lib/constants';
import { BorderControl, FillControl, KindControl, patchShapes } from './lib/controls';

export default defineFormat({
  id: 'shape.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'shape'),
  Component: ({ editor, selection }) => {
    const shapes = selection as ShapeElement[];
    const patch = (p: Partial<ShapeElement>) => patchShapes(editor, shapes, p);
    return (
      <>
        <KindControl editor={editor} shapes={shapes} />
        <FillControl editor={editor} shapes={shapes} />
        <BorderControl editor={editor} shapes={shapes} />
        <Divider vertical />
        <FontFamilyControl value={commonValue(shapes, (s) => s.fontFamily)} onChange={(fontFamily) => patch({ fontFamily })} />
        <FontSizeControl value={commonValue(shapes, (s) => s.fontSize)} sizes={FONT_SIZES} onChange={(fontSize) => patch({ fontSize })} />
        <TextColorControl editor={editor} value={commonValue(shapes, (s) => s.textColor)} onChange={(textColor) => patch({ textColor })} />
        <TextMarkButtons editor={editor} marks={['bold', 'italic', 'underline', 'strike', 'link']} />
        <TextAlignControl
          align={commonValue(shapes, (s) => s.align)}
          vAlign={commonValue(shapes, (s) => s.vAlign)}
          fallback="center"
          onChange={patch}
        />
      </>
    );
  },
});
