// What the board's live regions say (engine/ui/LiveRegion.tsx): the selection, read as type and
// text with its place in the keyboard walk, and — throttled — collaborators joining, leaving and
// changing things. Screen-reader users hear the board change without anyone polling it.
import type { BoardElement } from '@freero/shared';
import type { EngineCore } from '../runtime/core';
import { describeElement } from '../editor/typeLabel';
import { readingOrderByFrame } from '../geometry/order';

/** Selection changes settle this long (ms) before they are read (a drag-select fires many). */
export const SELECTION_SETTLE_MS = 150;
/** Joins / leaves are gathered this long (ms) into one sentence. */
export const PEOPLE_SETTLE_MS = 1500;
/** Remote edits are gathered at least this long (ms)… */
export const CHANGES_SETTLE_MS = 3000;
/** …and announced at most once per this interval (ms), however busy the board is. */
export const CHANGES_MIN_INTERVAL_MS = 10000;
/** After the first sync, this long (ms) passes before changes and people count as news. */
export const SYNC_QUIET_MS = 2000;

export interface Announcements {
  /** The selection (polite). */
  selection(message: string): void;
  /** Collaborators (polite, its own region so it never cuts a selection read-out short). */
  people(message: string): void;
}

const list = (names: string[]) =>
  names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "Sticky note: Ship on Friday. 2 of 14, in Frame: Retro." for one item; a count for several. */
export function selectionMessage(core: EngineCore, ids: string[]): string {
  const editor = core.editor;
  const els = ids.map((id) => editor.getElement(id)).filter((el): el is BoardElement => !!el);
  if (!els.length) return '';
  if (els.length > 1) {
    const grouped = !!els[0].groupId && els.every((el) => el.groupId === els[0].groupId);
    return grouped ? `Group of ${els.length} items selected.` : `${els.length} items selected.`;
  }
  const el = els[0];
  const walk = readingOrderByFrame(editor.getVisibleElements().filter((e) => e.type !== 'connector'));
  const at = walk.findIndex((e) => e.id === el.id);
  const frame = el.frameId ? editor.getElement(el.frameId) : undefined;
  const where = [at >= 0 ? `${at + 1} of ${walk.length}` : '', frame ? `in ${describeElement(editor, frame)}` : ''].filter(Boolean).join(', ');
  return `${describeElement(editor, el)}.${where ? ` ${where}.` : ''}`;
}

export function installAnnouncer(core: EngineCore, out: Announcements): () => void {
  const editor = core.editor;
  const store = core.store;
  const ownId = () => core.hostRef.current.user.id;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
    return t;
  };

  // ---- selection
  let selTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSaid = '';
  const offSelection = core.ui.subscribe((s, prev) => {
    if (s.selection === prev.selection) return;
    if (selTimer) clearTimeout(selTimer);
    selTimer = later(SELECTION_SETTLE_MS, () => {
      selTimer = null;
      const key = core.ui.getState().selection.join(',');
      if (key === lastSaid) return;
      lastSaid = key;
      const msg = selectionMessage(core, core.ui.getState().selection);
      if (msg) out.selection(msg);
    });
  });

  // ---- news gate: nothing that arrives with the first sync is news
  let quietUntil = Infinity;
  const watchSync = () => {
    if (quietUntil === Infinity && core.ui.getState().synced) quietUntil = Date.now() + SYNC_QUIET_MS;
  };
  watchSync();
  const offSync = core.ui.subscribe(watchSync);
  const isNews = () => Date.now() >= quietUntil;

  // ---- people joining / leaving (by user, not by tab)
  const peopleNow = () => {
    const m = new Map<string, string>();
    for (const p of store.getPeers()) if (p.user && p.user.id !== ownId()) m.set(p.user.id, p.user.name);
    return m;
  };
  let known = peopleNow();
  let joined = new Map<string, string>();
  let left = new Map<string, string>();
  let peopleTimer: ReturnType<typeof setTimeout> | null = null;
  const offPresence = store.subscribePresence(() => {
    const now = peopleNow();
    if (!isNews()) {
      known = now;
      return;
    }
    for (const [id, name] of now) if (!known.has(id)) left.has(id) ? left.delete(id) : joined.set(id, name);
    for (const [id, name] of known) if (!now.has(id)) joined.has(id) ? joined.delete(id) : left.set(id, name);
    known = now;
    if (peopleTimer || (!joined.size && !left.size)) return;
    peopleTimer = later(PEOPLE_SETTLE_MS, () => {
      peopleTimer = null;
      const parts = [];
      if (joined.size) parts.push(`${list([...joined.values()])} joined the board.`);
      if (left.size) parts.push(`${list([...left.values()])} left the board.`);
      joined = new Map();
      left = new Map();
      if (parts.length) out.people(parts.join(' '));
    });
  });

  // ---- other people's edits, throttled
  let pending = new Set<string>();
  let authors = new Set<string>();
  let changesTimer: ReturnType<typeof setTimeout> | null = null;
  let lastChangesAt = -Infinity;
  const offRemote = store.subscribeRemoteKeys((ids) => {
    if (!isNews()) return;
    for (const id of ids) pending.add(id);
    // Who: anyone whose selection or text editing touches the changed items.
    for (const p of store.getPeers()) {
      if (!p.user || p.user.id === ownId()) continue;
      if (ids.some((id) => p.editingId === id || p.selection?.includes(id))) authors.add(p.user.name);
    }
    if (changesTimer) return;
    const wait = Math.max(CHANGES_SETTLE_MS, lastChangesAt + CHANGES_MIN_INTERVAL_MS - Date.now());
    changesTimer = later(wait, () => {
      changesTimer = null;
      lastChangesAt = Date.now();
      const changed = [...pending];
      const who = [...authors];
      pending = new Set();
      authors = new Set();
      const subject = who.length === 1 ? who[0] : who.length ? list(who) : 'Someone';
      const one = changed.length === 1 ? editor.getElement(changed[0]) : undefined;
      const what = one ? describeElement(editor, one) : changed.length === 1 ? 'an item' : `${changed.length} items`;
      out.people(`${subject} changed ${what}.`);
    });
  });

  return () => {
    offSelection();
    offSync();
    offPresence();
    offRemote();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
