import type { TextElement } from '@freero/shared';
import { defineFormat } from '@engine';
import { Divider } from '@ui';
import {
  AlignButton,
  FontFamilyControl,
  FontSizeControl,
  HighlightControl,
  TextColorControl,
  TextStyleButtons,
} from './lib/controls';

export default defineFormat({
  id: 'text.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'text'),
  Component: ({ editor, selection }) => {
    const texts = selection as TextElement[];
    return (
      <>
        <FontFamilyControl editor={editor} texts={texts} />
        <FontSizeControl editor={editor} texts={texts} />
        <Divider vertical />
        <TextColorControl editor={editor} texts={texts} />
        <HighlightControl editor={editor} texts={texts} />
        <TextStyleButtons editor={editor} />
        <AlignButton editor={editor} texts={texts} />
      </>
    );
  },
});
