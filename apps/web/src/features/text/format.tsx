import type { TextElement } from '@freero/shared';
import {
  FontFamilyControl,
  FontSizeControl,
  TextAlignControl,
  TextColorControl,
  TextHighlightControl,
  TextMarkButtons,
  commonValue,
  defineFormat,
  type Editor,
} from '@engine';
import { Divider } from '@ui';
import { FONT_SIZES } from './lib/constants';

function patchTexts(editor: Editor, texts: TextElement[], patch: Partial<TextElement>) {
  editor.updateMany(texts.map((t) => ({ id: t.id, patch })));
}

export default defineFormat({
  id: 'text.format',
  order: 20,
  appliesTo: (selection) => selection.length > 0 && selection.every((el) => el.type === 'text'),
  Component: ({ editor, selection }) => {
    const texts = selection as TextElement[];
    const patch = (p: Partial<TextElement>) => patchTexts(editor, texts, p);
    return (
      <>
        <FontFamilyControl value={commonValue(texts, (t) => t.fontFamily)} onChange={(fontFamily) => patch({ fontFamily })} />
        <FontSizeControl
          value={commonValue(texts, (t) => t.fontSize)}
          sizes={FONT_SIZES}
          // Text boxes size to their text, so there is no 'auto' size to pick.
          onChange={(fontSize) => fontSize !== 'auto' && patch({ fontSize })}
        />
        <Divider vertical />
        <TextColorControl editor={editor} value={commonValue(texts, (t) => t.textColor)} onChange={(textColor) => patch({ textColor })} />
        <TextHighlightControl value={commonValue(texts, (t) => t.background || 'transparent')} onChange={(background) => patch({ background })} />
        <TextMarkButtons editor={editor} />
        <TextAlignControl align={commonValue(texts, (t) => t.align)} onChange={patch} />
      </>
    );
  },
});
