// Emoji reactions at moments of a walkthrough (#127): a viewer reacts at the current moment, and
// reactions show as marks on the timeline with their counts. They live with the walkthrough on the
// server; the board's `walkthroughs` summary carries how many, so every open player re-reads them.
import { useCallback, useEffect, useRef, useState } from 'react';
import { SmilePlus } from 'lucide-react';
import { WALKTHROUGH_REACTIONS, type WalkthroughReaction } from '@freero/shared';
import type { Editor } from '@engine';
import { IconButton, Popover } from '@ui';

const message = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong');

export interface ReactionsState {
  list: WalkthroughReaction[];
  refresh(): void;
}

export function useWalkthroughReactions(editor: Editor, id: string, count: number): ReactionsState {
  const [list, setList] = useState<WalkthroughReaction[]>([]);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    editor.host.walkthroughs?.reactions?.(id).then(
      (r) => live && setList(r),
      () => undefined, // no reactions shown: the player works as before
    );
    return () => {
      live = false;
    };
  }, [editor, id, count, rev]);
  const refresh = useCallback(() => setRev((r) => r + 1), []);
  return { list, refresh };
}

/** The bar's "React" button: pick an emoji, it lands at the moment playing now. */
export function ReactButton({ editor, id, t, state }: { editor: Editor; id: string; t: number; state: ReactionsState }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const host = editor.host.walkthroughs;
  if (!host?.react || editor.host.board.signedIn === false || !editor.can('commenter')) return null;
  const react = async (emoji: string) => {
    setOpen(false);
    try {
      await host.react!(id, { atMs: Math.round(t), emoji });
      state.refresh();
    } catch (e) {
      editor.host.notify(message(e), 'error');
    }
  };
  return (
    <>
      <IconButton ref={button} icon={SmilePlus} label="React at this moment" active={open} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} anchor={button.current} onClose={() => setOpen(false)} side="top" aria-label="Pick a reaction">
        <div className="fr-walkthrough-reactions" role="group" aria-label="Reactions">
          {WALKTHROUGH_REACTIONS.map((e) => (
            <button key={e} type="button" className="fr-walkthrough-reactions__pick" onClick={() => void react(e)} aria-label={`React ${e}`}>
              {e}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
