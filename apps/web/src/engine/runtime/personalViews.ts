// A person's own view settings on this board (Editor.getPersonalView / setPersonalView): personal
// overrides of the views items save for everyone (a kanban's board view). Never in the board doc
// — viewers may keep them, and nobody else ever sees them — so they live here, one store per
// board session, kept through Host.personalViews (the server: they follow the person to other
// devices) or, without it or while it fails (offline sandbox, guests, embeds), in this browser.
import { createStore, type StoreApi } from 'zustand';
import type { EngineCore } from './core';

type Settings = Record<string, unknown>;
/** itemId → viewId → settings. An item's entry is replaced (new identity) when any of its views changes. */
export type PersonalViewState = Readonly<Record<string, Readonly<Record<string, Settings>>>>;

export interface PersonalViews {
  state: StoreApi<PersonalViewState>;
  get(itemId: string, viewId: string): Settings | null;
  set(itemId: string, viewId: string, settings: Settings | null): void;
}

/** Each setting at most this big (JSON); larger ones are refused (the server refuses them too). */
export const MAX_PERSONAL_VIEW_BYTES = 4096;

const directories = new WeakMap<EngineCore, PersonalViews>();

const localKey = (core: EngineCore) => `freero:personal-views:${core.hostRef.current.board.id}:${core.hostRef.current.user.id}`;

function readLocal(core: EngineCore): PersonalViewState {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(localKey(core)) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeLocal(core: EngineCore, state: PersonalViewState) {
  try {
    localStorage.setItem(localKey(core), JSON.stringify(state));
  } catch {
    // storage unavailable (private mode): they last for this session
  }
}

function put(state: PersonalViewState, itemId: string, viewId: string, settings: Settings | null): PersonalViewState {
  const item = { ...(state[itemId] ?? {}) };
  if (settings) item[viewId] = settings;
  else delete item[viewId];
  const next = { ...state };
  if (Object.keys(item).length) next[itemId] = item;
  else delete next[itemId];
  return next;
}

export function personalViews(core: EngineCore): PersonalViews {
  const existing = directories.get(core);
  if (existing) return existing;
  const remote = core.hostRef.current.personalViews;
  const state = createStore<PersonalViewState>(() => (remote ? {} : readLocal(core)));
  // Changed here before the server answered: those win over what it had.
  const touched = new Set<string>();
  if (remote)
    remote.list().then(
      (rows) => {
        let next: PersonalViewState = {};
        for (const r of rows) if (r && typeof r.itemId === 'string' && typeof r.viewId === 'string' && r.settings && typeof r.settings === 'object') next = put(next, r.itemId, r.viewId, r.settings);
        for (const key of touched) {
          const [itemId, viewId] = key.split('\u0000');
          next = put(next, itemId, viewId, state.getState()[itemId]?.[viewId] ?? null);
        }
        state.setState(next, true);
      },
      () => state.setState({ ...readLocal(core), ...state.getState() }, true),
    );

  const dir: PersonalViews = {
    state,
    get: (itemId, viewId) => state.getState()[itemId]?.[viewId] ?? null,
    set(itemId, viewId, settings) {
      if (settings && JSON.stringify(settings).length > MAX_PERSONAL_VIEW_BYTES) return;
      touched.add(`${itemId}\u0000${viewId}`);
      state.setState(put(state.getState(), itemId, viewId, settings), true);
      if (!remote) return writeLocal(core, state.getState());
      // Kept in this browser too while the server can't be reached; it is read back if listing fails.
      remote.save(itemId, viewId, settings).catch(() => writeLocal(core, state.getState()));
    },
  };
  directories.set(core, dir);
  // Who folds what away may depend on them (a kanban showing me a table tab): EditorEvent 'personal-views'.
  state.subscribe(() => core.emitter.emit('personal-views'));
  return dir;
}
