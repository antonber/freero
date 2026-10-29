// Dropped caption files (.vtt, .srt) become a meeting frame. Markdown and text files stay with their
// own importers (a dropped .md is a doc, 30): only the board menu's "Import meeting notes…" reads
// those as meeting notes, so a drop never changes what an existing file type does. Above docs and
// the catch-all file card (12), below the diagram importers (60).
import { LayoutError } from '@freero/shared';
import { defineImporter } from '@engine';
import { importMeetingFile, summary, TRANSCRIPT_FILE } from './lib/insert';

export default defineImporter({
  id: 'meeting-notes',
  importPriority: 50,
  importData(editor, data, at) {
    if (!editor.can('editor')) return false;
    const files = data.files.filter((f) => TRANSCRIPT_FILE.test(f.name));
    if (!files.length) return false;
    void (async () => {
      let i = 0;
      for (const f of files) {
        const near = data.alongside ? undefined : { x: at.x + i * 40, y: at.y + i++ * 40 };
        await importMeetingFile(editor, f, {}, near).then(
          (r) => editor.host.notify(summary(r), 'success'),
          (e: unknown) => editor.host.notify(e instanceof LayoutError ? e.message : 'Could not import that transcript', 'error'),
        );
      }
    })();
    return files.length === data.files.length ? true : files;
  },
});
