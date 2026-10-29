// Dropped or pasted files of other tools (KAI-138) and Freero backups (KAI-137). Above the shape
// importer (Mermaid, 40) and the catch-all media importer (12), so a .drawio file never becomes a
// file card; images (100) keep their own files.
import { defineImporter, type Editor } from '@engine';
import { BACKUP_EXTENSION } from '@freero/shared';
import { ImportError, type ImportReport } from './lib/common';
import { IMPORT_DIALOG, importFile, kindOfFile, kindOfText, parseImport, placeImport, summary } from './lib/insert';

function announce(editor: Editor, report: ImportReport) {
  const details = report.skipped.length ? { action: { label: 'Details', run: () => editor.openPanel(IMPORT_DIALOG, { report }) } } : undefined;
  editor.host.notify(summary(report), 'success', details);
}

const failed = (editor: Editor) => (e: unknown) =>
  editor.host.notify(e instanceof ImportError ? e.message : 'Could not import that file', 'error');

export default [
  defineImporter({
    id: 'backup',
    importPriority: 60,
    importData(editor, data) {
      const backup = data.files.find((f) => f.name.toLowerCase().endsWith(BACKUP_EXTENSION));
      if (!backup) return false;
      // A backup is a whole board: restored as a new one, never poured into this one.
      if (editor.host.openBackup) editor.host.openBackup(backup);
      else editor.host.notify('Restore board backups from your dashboard (Restore backup).', 'info');
      return [backup];
    },
  }),
  defineImporter({
    id: 'diagrams',
    importPriority: 60,
    async importData(editor, data, at) {
      if (!editor.can('editor')) return false;
      const files: File[] = [];
      for (const f of data.files) if (kindOfFile(f.name, f.size < 64 * 1024 * 1024 ? await f.slice(0, 2000).text() : '')) files.push(f);
      if (files.length) {
        for (const f of files) await importFile(editor, f, data.alongside ? undefined : at).then((r) => announce(editor, r), failed(editor));
        return files;
      }
      // A diagram copied out of draw.io or Excalidraw and pasted here.
      const kind = data.files.length ? null : kindOfText(data.text);
      if (!kind || !data.text) return false;
      await parseImport(kind, data.text)
        .then((r) => placeImport(editor, r, at))
        .then((r) => announce(editor, r), failed(editor));
      return true;
    },
  }),
];
