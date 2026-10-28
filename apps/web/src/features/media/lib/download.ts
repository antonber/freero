// "Download" for file cards and video / audio items: through the Host, which asks the server
// (the workspace's downloads policy, the audit log) and saves under the item's name.
import type { FileElement, MediaElement } from '@freero/shared';
import type { Editor } from '@engine';

export type Downloadable = FileElement | MediaElement;

export const isDownloadable = (el: { type: string } | undefined): el is Downloadable => el?.type === 'file' || el?.type === 'media';

/** Why this person can't download here, or null when they can. */
export function downloadBlockedReason(editor: Editor): string | null {
  if (!editor.host.downloadFile) return 'Downloads aren’t available here';
  if (editor.host.board.canExport === false) return 'This workspace doesn’t allow you to download its files';
  return null;
}

export async function downloadItem(editor: Editor, el: Downloadable): Promise<void> {
  const blocked = downloadBlockedReason(editor);
  if (blocked) {
    editor.host.notify(`${blocked}.`, 'info');
    return;
  }
  try {
    await editor.host.downloadFile!({ id: el.id, src: el.src, name: el.name });
  } catch (e) {
    editor.host.notify(e instanceof Error && e.message ? e.message : `Couldn't download “${el.name}”. Try again later.`, 'error');
  }
}
