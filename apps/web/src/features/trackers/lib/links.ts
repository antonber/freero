// Which items are linked to which tracker issue, read from the board: an item's `trackerLink`
// counts only while its issue's record (the `trackers` collection, written by the server) lists
// it — a copy of a linked item carries the field but is not linked.
import { TRACKER_COLLECTION, type BoardElement, type TrackerIssueRecord } from '@freero/shared';
import { isSafeHref, type Editor } from '@engine';

export const SEND_DIALOG = 'trackers.send';
export const IMPORT_DIALOG = 'trackers.import';

/** Items that can become (part of) an issue: they hold text. */
const SENDABLE = new Set(['sticky', 'card', 'shape', 'text', 'mindmap']);

export function recordOf(
  records: ReadonlyMap<string, TrackerIssueRecord> | ((id: string) => TrackerIssueRecord | undefined),
  el: BoardElement,
): { id: string; record: TrackerIssueRecord } | null {
  const id = el.trackerLink;
  if (!id) return null;
  const record = typeof records === 'function' ? records(id) : records.get(id);
  return record && Array.isArray(record.sources) && record.sources.includes(el.id) ? { id, record } : null;
}

/** The one selected timeline (roadmap mode, KAI-160: issues imported onto it become its bars). */
export function selectedTimeline(editor: Editor): BoardElement | null {
  const sel = selected(editor);
  return sel.length === 1 && sel[0].type === 'timeline' && !sel[0].locked ? sel[0] : null;
}

export function selected(editor: Editor): BoardElement[] {
  return editor
    .getSelection()
    .map((id) => editor.getElement(id))
    .filter((el): el is BoardElement => !!el);
}

const records = (editor: Editor) => {
  const c = editor.collection<TrackerIssueRecord>(TRACKER_COLLECTION);
  return (id: string) => c.get(id);
};

/** Selected items that can still be sent: they hold text and aren't linked yet. */
export function sendable(editor: Editor): BoardElement[] {
  const get = records(editor);
  return selected(editor).filter((el) => SENDABLE.has(el.type) && !el.locked && !recordOf(get, el));
}

/** The issues the selected items are linked to (each once). */
export function linkedIssues(editor: Editor): Array<{ id: string; record: TrackerIssueRecord }> {
  const get = records(editor);
  const out = new Map<string, TrackerIssueRecord>();
  for (const el of selected(editor)) {
    const hit = recordOf(get, el);
    if (hit) out.set(hit.id, hit.record);
  }
  return [...out].map(([id, record]) => ({ id, record }));
}

/** Tracker actions show only when the server offered a connection here and this person can edit. */
export const trackersAvailable = (editor: Editor): boolean => !!editor.host.trackers && (editor.getRole() === 'owner' || editor.getRole() === 'editor');

/** Opens an issue's page. The URL comes from the tracker: only a safe web link opens. */
export function openIssue(url: string): void {
  if (!/^https?:\/\//i.test(url) || !isSafeHref(url)) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}
