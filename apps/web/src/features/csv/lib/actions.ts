// CSV export from the board (KAI-136): what is selected (else every sticky and card), downloaded in
// the browser and reported to the server, which records it in the workspace's audit log.
import { richTextToPlain } from '@freero/shared';
import type { Editor } from '@engine';
import { exportRows, toCsv } from './csv';
import { itemsToExport, toRows } from './board';

export const CSV_IMPORT_DIALOG = 'csv.import';

/** A file name safe everywhere, from the board's title. */
export function csvFileName(title: string): string {
  const base = title.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  return `${base || 'Freero board'} - items.csv`;
}

export async function exportCsv(editor: Editor): Promise<void> {
  const items = itemsToExport(editor);
  if (!items.length) {
    editor.host.notify(editor.getSelection().length ? 'The selection has no stickies or cards' : 'This board has no stickies or cards yet', 'info');
    return;
  }
  // Assignees by name: the board's member directory (presence as a fallback).
  const names = new Map<string, string>();
  for (const p of editor.getPeers()) if (p.user) names.set(p.user.id, p.user.name);
  try {
    for (const m of await editor.host.listMembers()) names.set(m.id, m.name);
  } catch {
    // keep presence names
  }
  const csv = toCsv(exportRows(toRows(editor, items, names)));
  // BOM: spreadsheet apps then read the file as UTF-8.
  const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = csvFileName(richTextToPlain(editor.host.board.title));
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  editor.host.reportExport?.('csv');
  editor.host.notify(`Exported ${items.length} ${items.length === 1 ? 'item' : 'items'} as CSV`, 'success');
}
