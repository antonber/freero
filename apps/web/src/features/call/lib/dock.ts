// Whether this tab is in the board's docked call (#149), shared by the top bar's button and the
// docked panel (two panels of this feature), per board. Leaving the board leaves the call: the
// docked panel unmounts, hangs up and resets this.
import { useSyncExternalStore } from 'react';
import type { Editor } from '@engine';

export interface DockState {
  joined: boolean;
  /** The panel is folded down to its header (the call goes on). */
  folded: boolean;
}

interface Store {
  state: DockState;
  listeners: Set<() => void>;
}

const OUT: DockState = { joined: false, folded: false };
const stores = new Map<string, Store>();

function storeOf(editor: Editor): Store {
  const id = editor.host.board.id;
  let s = stores.get(id);
  if (!s) stores.set(id, (s = { state: OUT, listeners: new Set() }));
  return s;
}

export function setDock(editor: Editor, patch: Partial<DockState>): void {
  const s = storeOf(editor);
  s.state = { ...s.state, ...patch };
  for (const l of s.listeners) l();
}

export function useDock(editor: Editor): DockState {
  const s = storeOf(editor);
  return useSyncExternalStore(
    (l) => {
      s.listeners.add(l);
      return () => void s.listeners.delete(l);
    },
    () => s.state,
  );
}
