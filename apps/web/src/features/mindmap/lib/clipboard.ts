// "Copy as outline": the selected maps on the clipboard as an indented Markdown list (plain text)
// plus nested HTML lists, so they paste as bullets into documents and back into Freero as a map.
import type { Editor } from '@engine';
import { currentIndex } from './actions';
import { mapsToOutline } from './outline';

export async function copyOutline(editor: Editor, rootIds: string[]): Promise<void> {
  if (!rootIds.length) return;
  const { text, html } = mapsToOutline(currentIndex(editor), rootIds, (id) => (editor.getElement(id) as { text?: string } | undefined)?.text ?? '');
  try {
    if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) }),
      ]);
    } else await navigator.clipboard.writeText(text);
    editor.host.notify('Copied as an outline', 'success');
  } catch {
    editor.host.notify('The browser didn’t allow copying to the clipboard', 'error');
  }
}
