import { Type as TypeIcon } from 'lucide-react';
import { memo, type CSSProperties } from 'react';
import type { TextElement } from '@freero/shared';
import { canvasInk, defineElement, ElementText, richTextToPlain, type ElementRenderProps, type LowDetailPaint, type NewElement } from '@engine';
import { layoutText, measureTextBox, textPadding } from './lib/layout';
import { pastedTextToRich, textBlockAt, textDefaults } from './lib/actions';
import { t } from './messages';
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
      placeholder={t('typeSomething')}
      className={`fr-textbox${element.autoWidth ? ' fr-textbox--auto' : ''}${style ? ' fr-textbox--hl' : ''}`}
      style={style}
      // On the canvas (no highlight of its own) the default ink turns light on a dark page.
      color={style ? element.textColor : canvasInk(element.textColor)}
    />
  );
});

/**
 * Zoomed out to low detail (#131): its lines as faint bars at the text's own line height, in its
 * ink (light on a dark page, as the full drawing paints it) — no text layout.
 */
function paintText(el: TextElement, p: LowDetailPaint) {
  const highlighted = !!el.background && el.background !== 'transparent';
  if (highlighted) p.box({ fill: el.background, radius: 4 });
  const ink = highlighted ? el.textColor : canvasInk(el.textColor);
  const pad = textPadding(el.fontSize);
  const line = el.fontSize * 1.4;
  const bar = el.fontSize * 0.7;
  const rows = Math.max(1, Math.floor((el.h - pad * 2 + 0.5) / line));
  for (let i = 0; i < rows; i++) {
    const w = (el.w - pad * 2) * (i === rows - 1 && rows > 1 ? 0.6 : 1);
    const x = el.align === 'center' ? (el.w - w) / 2 : el.align === 'right' ? el.w - pad - w : pad;
    p.rect(x, pad + i * line + (line - bar) / 2, w, bar, ink, 0.3);
  }
}

export default defineElement({
  type: 'text',
  label: { one: t('text'), many: t('text') },
  icon: TypeIcon,
  // Corners scale the text (font size follows); side handles set a wrapping width.
  resize: 'scale',
  minSize: { w: 16, h: 8 },
  sharedStyle: (el) => ({ fontFamily: el.fontFamily, fontSize: el.fontSize, textColor: el.textColor, align: el.align }),
  // A free text box has no box to fit text into: 'auto' leaves its size alone.
  applySharedStyle: (_el, { fontSize, ...rest }) => ({ ...rest, ...(typeof fontSize === 'number' ? { fontSize } : {}) }),
  textField: 'text',
  removeWhenEmpty: true,
  defaults: (): Omit<NewElement<'text'>, 'x' | 'y'> => textDefaults(),
  Component: TextView,
  lowDetail: paintText,
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
