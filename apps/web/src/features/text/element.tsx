import { memo, type CSSProperties } from 'react';
import type { TextElement } from '@freero/shared';
import { defineElement, ElementText, richTextToPlain, type ElementRenderProps, type NewElement } from '@engine';
import { layoutText, measureTextBox, textPadding } from './lib/layout';
import { pastedTextToRich, textBlockAt, textDefaults } from './lib/actions';
import './text.css';

const TextView = memo(function TextView({ element }: ElementRenderProps<TextElement>) {
  const pad = textPadding(element.fontSize);
  const style: CSSProperties | undefined =
    element.background && element.background !== 'transparent' ? { background: element.background } : undefined;
  return (
    <ElementText
      element={element}
      field="text"
      padding={pad}
      fontSize={element.fontSize}
      vAlign="top"
      placeholder="Type something…"
      className={`fr-textbox${element.autoWidth ? ' fr-textbox--auto' : ''}${style ? ' fr-textbox--hl' : ''}`}
      style={style}
    />
  );
});

export default defineElement({
  type: 'text',
  // Corners scale the text (font size follows); side handles set a wrapping width.
  resize: 'scale',
  minSize: { w: 16, h: 8 },
  textField: 'text',
  removeWhenEmpty: true,
  defaults: (): Omit<NewElement<'text'>, 'x' | 'y'> => textDefaults(),
  Component: TextView,
  toPlainText: (el) => richTextToPlain(el.text),
  normalize: (el, prev) => layoutText(el, prev, (wrap) => measureTextBox(el.text, el.fontFamily, el.fontSize, wrap)),
  // Double-click a side handle: back from a fixed wrapping width to hugging the text.
  fitToContent: (el, handle) => (!el.autoWidth && (handle === 'e' || handle === 'w') ? { autoWidth: true } : null),
  // Prose pastes as a text box. Lists (and any paste onto selected stickies) are claimed first by
  // the sticky importer (priority 5, rule in features/sticky/lib/paste.ts); tables by the table one.
  importPriority: 0,
  importData(editor, data, at) {
    const html = data.files.length ? null : pastedTextToRich(data.text);
    if (!html) return false;
    editor.create(textBlockAt(at, html), { select: true });
    return true;
  },
});
