// The board's version list, shared by the history panel and the preview (one board at a time),
// and the actions both offer. Versions live on the server (Host.versions); nothing here is synced.
import { useEffect, useSyncExternalStore } from 'react';
import type { BoardVersion } from '@freero/shared';
import type { Editor } from '@engine';

interface VersionsState {
  boardId: string | null;
  versions: BoardVersion[] | null;
  loading: boolean;
  error: string | null;
}

let state: VersionsState = { boardId: null, versions: null, loading: false, error: null };
const listeners = new Set<() => void>();
let request = 0;

function set(patch: Partial<VersionsState>) {
  state = { ...state, ...patch };
  for (const l of [...listeners]) l();
}

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');

/** (Re)loads the version list of the editor's board. */
export async function refreshVersions(editor: Editor): Promise<void> {
  const boardId = editor.boardId;
  const mine = ++request;
  set(state.boardId === boardId ? { loading: true, error: null } : { boardId, versions: null, loading: true, error: null });
  try {
    const versions = await editor.host.versions.list();
    if (mine === request) set({ versions, loading: false });
  } catch (e) {
    if (mine === request) set({ loading: false, error: message(e) });
  }
}

/** The version list of the editor's board; loads it on first use. */
export function useVersions(editor: Editor): VersionsState {
  const s = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
  useEffect(() => {
    if (state.boardId !== editor.boardId || (!state.versions && !state.loading)) void refreshVersions(editor);
  }, [editor]);
  return s.boardId === editor.boardId ? s : { boardId: editor.boardId, versions: null, loading: true, error: null };
}

/** Names the board as it is right now. True when it worked (the user was told otherwise). */
export async function nameCurrentVersion(editor: Editor, name: string): Promise<boolean> {
  try {
    await editor.host.versions.nameCurrent(name);
    editor.host.notify(`Saved “${name}” as a version`, 'success');
    void refreshVersions(editor);
    return true;
  } catch (e) {
    editor.host.notify(message(e), 'error');
    return false;
  }
}

export async function renameVersion(editor: Editor, v: BoardVersion, name: string): Promise<boolean> {
  try {
    await editor.host.versions.rename(v.id, name);
    void refreshVersions(editor);
    return true;
  } catch (e) {
    editor.host.notify(message(e), 'error');
    return false;
  }
}

/**
 * Restores `v` for everyone. The toast offers Undo, which restores the board as it was just before
 * (itself a restore, so it shows up in the history too).
 */
export async function restoreVersion(editor: Editor, v: BoardVersion, mode: 'restore' | 'undo' | 'redo' = 'restore'): Promise<boolean> {
  try {
    const before = await editor.host.versions.restore(v.id);
    const text =
      mode === 'undo'
        ? 'Restore undone for everyone'
        : mode === 'redo'
          ? 'Restored again for everyone'
          : `Restored the version from ${formatWhen(v.createdAt)} for everyone`;
    editor.host.notify(text, 'success', {
      action:
        mode === 'undo'
          ? { label: 'Redo', run: () => void restoreVersion(editor, before, 'redo') }
          : { label: 'Undo', run: () => void restoreVersion(editor, before, 'undo') },
    });
    void refreshVersions(editor);
    return true;
  } catch (e) {
    editor.host.notify(message(e), 'error');
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------------------------

export function versionTitle(v: BoardVersion): string {
  if (v.kind === 'named' && v.name) return v.name;
  if (v.kind === 'before-restore') return 'Before a restore';
  return 'Autosaved';
}

export function versionByline(v: BoardVersion): string | null {
  if (!v.createdBy) return null;
  return v.kind === 'before-restore' ? `${v.createdBy.name} restored an earlier version` : `Named by ${v.createdBy.name}`;
}

const time = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const dayWithYear = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export const formatTime = (ms: number) => time.format(ms);

const startOfDay = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

export function dayLabel(ms: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ms)) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return new Date(ms).getFullYear() === new Date(now).getFullYear() ? day.format(ms) : dayWithYear.format(ms);
}

export function formatWhen(ms: number, now = Date.now()): string {
  return `${dayLabel(ms, now).replace(/^Today$/, 'today').replace(/^Yesterday$/, 'yesterday')}, ${formatTime(ms)}`;
}

/** Versions (newest first) grouped by local calendar day. */
export function groupByDay(versions: BoardVersion[], now = Date.now()): Array<{ label: string; items: BoardVersion[] }> {
  const groups: Array<{ key: number; label: string; items: BoardVersion[] }> = [];
  for (const v of versions) {
    const key = startOfDay(v.createdAt);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(v);
    else groups.push({ key, label: dayLabel(v.createdAt, now), items: [v] });
  }
  return groups;
}
