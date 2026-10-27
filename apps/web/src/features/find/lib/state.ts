// Local find state for one board session: the query, options, which match is current, and a
// nonce that asks the input to take focus (Ctrl/⌘+F while the panel is already open).
import { createStore, useStore, type StoreApi } from 'zustand';
import type { Editor } from '@engine';

export interface FindUi {
  query: string;
  replacement: string;
  caseSensitive: boolean;
  showReplace: boolean;
  /** Key (Source.key) of the current match, or null. */
  currentKey: string | null;
  focusNonce: number;
}

const sessions = new WeakMap<Editor, StoreApi<FindUi>>();

/** The scoped find Editor is cached per board session, so it keys the state. */
export function findStore(editor: Editor): StoreApi<FindUi> {
  let s = sessions.get(editor);
  if (!s) {
    s = createStore<FindUi>(() => ({
      query: '',
      replacement: '',
      caseSensitive: false,
      showReplace: false,
      currentKey: null,
      focusNonce: 0,
    }));
    sessions.set(editor, s);
  }
  return s;
}

export function useFindUi<T>(editor: Editor, sel: (s: FindUi) => T): T {
  return useStore(findStore(editor), sel);
}

export function setFindUi(editor: Editor, patch: Partial<FindUi> | ((s: FindUi) => Partial<FindUi>)) {
  findStore(editor).setState(patch);
}
