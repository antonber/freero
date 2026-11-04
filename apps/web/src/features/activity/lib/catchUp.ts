// "Changes since your last visit" and finding an activity entry's items, for one board session:
// what the server said changed (Host.activity.catchUp / catchUpChanges), and which items are
// highlighted on the board right now with the one the person stepped to.
import { createStore, useStore, type StoreApi } from 'zustand';
import type { ActivityEntry, CatchUpChanges, CatchUpItem, CatchUpSummary } from '@freero/shared';
import type { Editor } from '@engine';
import { formatDate, formatList, formatTime } from '@ui';
import { PANEL_ID } from './ids';

import { t } from '../messages';
export type MarkKind = 'added' | 'changed';

export interface Highlight {
  /** What the bar calls it: "Recent changes", "Ann’s changes". */
  label: string;
  /** In stepping order. */
  items: Array<{ id: string; kind: MarkKind }>;
  /** The item stepped to (index into `items`), or -1 before the first step. */
  index: number;
  source: 'catch-up' | 'entry';
}

export interface CatchUpUi {
  summary: CatchUpSummary | null;
  /** The bar was closed (until the next visit). */
  dismissed: boolean;
  changes: CatchUpChanges | null;
  loading: boolean;
  error: string | null;
  highlight: Highlight | null;
}

const sessions = new WeakMap<Editor, StoreApi<CatchUpUi>>();

/** The scoped activity Editor is cached per board session, so it keys the state. */
export function catchUpStore(editor: Editor): StoreApi<CatchUpUi> {
  let s = sessions.get(editor);
  if (!s) {
    s = createStore<CatchUpUi>(() => ({ summary: null, dismissed: false, changes: null, loading: false, error: null, highlight: null }));
    sessions.set(editor, s);
  }
  return s;
}

export const useCatchUp = <T>(editor: Editor, sel: (s: CatchUpUi) => T): T => useStore(catchUpStore(editor), sel);
const set = (editor: Editor, patch: Partial<CatchUpUi>) => catchUpStore(editor).setState(patch);

export const totalChanges = (s: CatchUpSummary) => s.counts.added + s.counts.changed + s.counts.removed;

/** "Ann", "Ann and Bob", "Ann, Bob and 3 others" (in the interface's language) */
export function peopleText(names: string[]): string {
  if (!names.length) return t('catchUp.someone');
  if (names.length <= 3) return formatList(names);
  return t('catchUp.namesAndOthers', { first: names[0], second: names[1], count: names.length - 2 });
}

/** "added 4, changed 2 and removed 1 item · 3 new comments" */
export function countsText(c: CatchUpSummary['counts']): string {
  const parts: string[] = [];
  if (c.added) parts.push(t('catchUp.added', { count: c.added }));
  if (c.changed) parts.push(t('catchUp.changed', { count: c.changed }));
  if (c.removed) parts.push(t('catchUp.removed', { count: c.removed }));
  const total = c.added + c.changed + c.removed;
  const edits = parts.length ? t('catchUp.edits', { what: formatList(parts), count: total }) : '';
  return [edits, c.comments ? t('countNewComment', { count: c.comments }) : ''].filter(Boolean).join(' · ');
}

/** "Tue 14:05", "yesterday 09:30", "today 08:10" (the reader's own clock). */
export function sinceText(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const time = formatTime(d, { hour: '2-digit', minute: '2-digit' });
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(new Date(now)) - day(d)) / 86_400_000);
  if (days <= 0) return t('catchUp.todayAt', { time });
  if (days === 1) return t('catchUp.yesterdayAt', { time });
  if (days < 7) return t('catchUp.weekdayAt', { day: formatDate(d, { weekday: 'short' }), time });
  return formatDate(d, { month: 'short', day: 'numeric' });
}

/** Asks the server once per board session whether others changed the board since the last visit. */
export function loadSummary(editor: Editor): void {
  const source = editor.host.activity;
  const st = catchUpStore(editor).getState();
  if (!source?.catchUp || st.summary) return;
  source.catchUp().then(
    (summary) => set(editor, { summary }),
    () => undefined, // nothing to offer: the board works as before
  );
}

/** The items to step through: added and changed ones still on the board, newest first. */
export function stepItems(changes: CatchUpChanges, present: (id: string) => boolean): Highlight['items'] {
  const out: Highlight['items'] = [];
  const seen = new Set<string>();
  const merged: Array<CatchUpItem & { mark: MarkKind }> = [
    ...changes.added.map((i) => ({ ...i, mark: 'added' as const })),
    ...changes.changed.map((i) => ({ ...i, mark: 'changed' as const })),
  ].sort((a, b) => b.at - a.at);
  for (const i of merged) if (!seen.has(i.id) && present(i.id)) (seen.add(i.id), out.push({ id: i.id, kind: i.mark }));
  return out;
}

/** "See recent changes": loads what changed, highlights it on the board and goes to the newest. */
export async function showChanges(editor: Editor): Promise<void> {
  const source = editor.host.activity;
  if (!source?.catchUpChanges) return;
  set(editor, { loading: true, error: null });
  try {
    const changes = await source.catchUpChanges();
    if (totalChanges(changes) === 0) {
      set(editor, { changes: null, summary: changes, loading: false });
      editor.host.notify(changes.since ? t('nobodyElseChangedTheBoard') : t('thereSNoEarlierVisit'), 'info');
      return;
    }
    const items = stepItems(changes, (id) => !!editor.getElement(id));
    set(editor, { changes, summary: changes, loading: false, dismissed: false, highlight: { label: t('recentChanges'), items, index: -1, source: 'catch-up' } });
    if (items.length) step(editor, 1);
    else if (changes.removed.length) editor.openDock(PANEL_ID);
    else editor.host.notify(t('nothingOthersChangedIsOn'), 'info');
  } catch (err) {
    set(editor, { loading: false, error: err instanceof Error && err.message ? err.message : t('recentChangesCouldnTBe') });
    editor.host.notify(t('recentChangesCouldnTBe'), 'error');
  }
}

/** Brings the item at `index` into view (wrapping), skipping ones removed meanwhile. */
export function goTo(editor: Editor, index: number): void {
  const h = catchUpStore(editor).getState().highlight;
  if (!h) return;
  const items = h.items.filter((i) => !!editor.getElement(i.id));
  if (!items.length) {
    set(editor, { highlight: { ...h, items, index: -1 } });
    return;
  }
  const at = ((index % items.length) + items.length) % items.length;
  set(editor, { highlight: { ...h, items, index: at } });
  editor.zoomToFit([items[at].id], { maxZoom: Math.max(1, editor.getCamera().zoom), padding: 160 });
}

export function step(editor: Editor, dir: 1 | -1): void {
  const h = catchUpStore(editor).getState().highlight;
  if (!h) return;
  goTo(editor, h.index < 0 ? (dir > 0 ? 0 : h.items.length - 1) : h.index + dir);
}

/** Steps to one item by id (a row of the list). */
export function goToItem(editor: Editor, id: string): void {
  const h = catchUpStore(editor).getState().highlight;
  if (!h) return;
  const i = h.items.findIndex((x) => x.id === id);
  if (i >= 0) goTo(editor, i);
}

export function endHighlight(editor: Editor): void {
  set(editor, { highlight: null });
}

export function dismiss(editor: Editor): void {
  set(editor, { dismissed: true, highlight: null });
}

/**
 * An activity entry's items on the board: highlights the ones still there and fits them in view.
 * Says so when some or all of them are gone (removed since, or never visible to this reader).
 */
export function locateEntry(editor: Editor, e: ActivityEntry): void {
  const ids = e.items ?? [];
  const here = ids.filter((id) => !!editor.getElement(id));
  if (!here.length) {
    editor.host.notify(ids.length ? t('thoseItemsArenTOn') : t('nothingOfThisIsOn'), 'info');
    return;
  }
  set(editor, { highlight: { label: t('actornameSChanges', { actorName: e.actorName }), items: here.map((id) => ({ id, kind: 'changed' })), index: -1, source: 'entry' } });
  editor.zoomToFit(here, { maxZoom: Math.max(1, editor.getCamera().zoom), padding: 160 });
  const gone = ids.length - here.length;
  if (gone > 0) editor.host.notify(t('goneOfLengthItemsAre', { length: ids.length, gone }), 'info');
}
