// CSV exports of other whiteboards (Mural's "Download to CSV", Lucid's "CSV of Shape Data"): RFC
// 4180 rows, recognised by their header. Pure.

/** Rows of cells (quotes, doubled quotes, line breaks inside quotes, CRLF, a BOM); empty rows dropped. */
export function csvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** The header's columns by lower-cased name. */
export function columns(header: string[]): Map<string, number> {
  const m = new Map<string, number>();
  header.forEach((h, i) => {
    const k = h.trim().toLowerCase();
    if (!m.has(k)) m.set(k, i);
  });
  return m;
}

/** The first line of `text`, split as CSV (enough to recognise an export by its header). */
export function headerOf(text: string): string[] {
  const first = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  return first.split(',').map((h) => h.replace(/^"|"$/g, '').trim().toLowerCase());
}
