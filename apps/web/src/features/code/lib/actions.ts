import type { CodeElement } from '@freero/shared';
import type { Editor, NewElement, Point } from '@engine';
import { AUTO } from './languages';
import { DEFAULT_W, heightOf, widthFor } from './layout';

/** A new block centered on `at`; a pasted block is as wide as its longest line. */
export function codeAt(at: Point, fields: Partial<Pick<CodeElement, 'code' | 'language' | 'lineNumbers' | 'theme'>> = {}): NewElement<'code'> {
  const base = { code: '', language: AUTO, lineNumbers: true, theme: 'light' as const, ...fields };
  const w = base.code ? widthFor(base) : DEFAULT_W;
  const h = heightOf(base.code);
  return { type: 'code', ...base, w, h, x: Math.round(at.x - w / 2), y: Math.round(at.y - h / 2) };
}

/** Puts a block's code (exactly as stored: plain text) on the clipboard. */
export async function copyCode(editor: Editor, code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    editor.host.notify('Code copied', 'success');
    return true;
  } catch {
    editor.host.notify('Couldn’t copy: the browser blocked the clipboard', 'error');
    return false;
  }
}

export const selectedCode = (editor: Editor): CodeElement[] =>
  editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is CodeElement => el?.type === 'code');
