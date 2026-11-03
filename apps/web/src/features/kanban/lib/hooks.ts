// Subscriptions the table and focus mode read through the Editor they are handed (so they work the
// same on the canvas, in a dialog panel and in tests): one kanban, its cards, this person's own
// view settings, and the board's tags. Each re-renders its caller only when what it reads changed.
import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { isMember, type CardElement, type KanbanElement, type Tag } from '@freero/shared';
import type { Editor } from '@engine';

/** Kanban `id` and the cards it holds (same arrays while neither changes: typing in a sticky elsewhere re-renders nothing). */
export function useKanbanCards(editor: Editor, id: string | null): { k: KanbanElement | null; cards: CardElement[] } {
  const cache = useRef<{ all: unknown; k: KanbanElement | null; cards: CardElement[]; value: { k: KanbanElement | null; cards: CardElement[] } } | null>(null);
  const subscribe = useCallback((cb: () => void) => editor.on('elements', cb), [editor]);
  const get = useCallback(() => {
    const all = editor.getElements();
    const c = cache.current;
    if (c && c.all === all) return c.value;
    const found = id ? editor.getElement<KanbanElement>(id) : undefined;
    const k = found && found.type === 'kanban' ? found : null;
    const cards = k ? all.filter((el): el is CardElement => isMember(k, el)) : [];
    if (c && c.k === k && c.cards.length === cards.length && c.cards.every((x, i) => x === cards[i])) {
      c.all = all;
      return c.value;
    }
    cache.current = { all, k, cards, value: { k, cards } };
    return cache.current.value;
  }, [editor, id]);
  return useSyncExternalStore(subscribe, get, get);
}

/** Kanban `id` as it is now (null: not on the board for me, or not a kanban); re-renders only when that element changes. */
export function useKanban(editor: Editor, id: string | null): KanbanElement | null {
  const subscribe = useCallback((cb: () => void) => editor.on('elements', cb), [editor]);
  const get = useCallback(() => {
    const el = id ? editor.getElement<KanbanElement>(id) : undefined;
    return el && el.type === 'kanban' ? el : null;
  }, [editor, id]);
  return useSyncExternalStore(subscribe, get, get);
}

/** This person's own settings `key` of item `itemId` (Editor.getPersonalView); re-renders when they change. */
export function useMine(editor: Editor, itemId: string | null, key: string): Record<string, unknown> | null {
  const subscribe = useCallback((cb: () => void) => editor.on('personal-views', cb), [editor]);
  const get = useCallback(() => (itemId ? editor.getPersonalView(itemId, key) : null), [editor, itemId, key]);
  return useSyncExternalStore(subscribe, get, get);
}

/** The board's tags (the tags feature's collection), by id. */
export function useTags(editor: Editor): ReadonlyMap<string, Tag> {
  const coll = useMemo(() => editor.collection<Tag>('tags'), [editor]);
  const cache = useRef<{ version: number; value: ReadonlyMap<string, Tag> }>({ version: -1, value: new Map() });
  const version = useRef(0);
  const subscribe = useCallback(
    (cb: () => void) =>
      coll.observe(() => {
        version.current++;
        cb();
      }),
    [coll],
  );
  const get = useCallback(() => {
    if (cache.current.version !== version.current) cache.current = { version: version.current, value: new Map(coll.entries()) };
    return cache.current.value;
  }, [coll]);
  return useSyncExternalStore(subscribe, get, get);
}
