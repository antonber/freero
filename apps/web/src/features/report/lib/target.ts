import type { BoardElement, ReportTarget } from '@freero/shared';

/** The open-report dialog (a 'dialog' panel): commands open it with editor.openPanel(REPORT_DIALOG, { target }). */
export const REPORT_DIALOG = 'report.dialog';

const UPLOAD_SRC = /^\/uploads\/([A-Za-z0-9_-]{6,64}\.(?:png|jpg|gif|webp|svg|pdf))$/;

/**
 * What reporting one item reports: the uploaded file itself for an image or document shown from
 * Freero's uploads (operators can then remove the file everywhere it is used), else the item.
 */
export function reportTargetOf(el: BoardElement): ReportTarget {
  const src = (el as { src?: unknown }).src;
  const m = typeof src === 'string' ? UPLOAD_SRC.exec(src) : null;
  return m ? { kind: 'upload', id: m[1] } : { kind: 'element', id: el.id };
}

export function isReportTarget(v: unknown): v is ReportTarget {
  const t = v as ReportTarget | null;
  return !!t && ['board', 'element', 'upload', 'comment'].includes(t.kind) && (t.id === undefined || typeof t.id === 'string');
}

export const TARGET_NOUN: Record<ReportTarget['kind'], string> = {
  board: 'this board',
  element: 'this item',
  upload: 'this file',
  comment: 'this comment',
};
