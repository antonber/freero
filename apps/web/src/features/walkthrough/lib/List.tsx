// The board's walkthroughs (a dock panel) and the top-bar button that opens it. The list comes from
// the server-written `walkthroughs` collection, so a new recording, a view or a comment shows up
// live for everyone on the board.
import { useEffect, useState } from 'react';
import { CirclePlay, Link2, Mic, Trash2, Video } from 'lucide-react';
import { formatObjectUri, formatWalkthroughTime, WALKTHROUGHS_COLLECTION, type WalkthroughSummary } from '@freero/shared';
import { DockHeader, useCollection, useDock, usePeople, type Editor, type PanelProps } from '@engine';
import { Button, IconButton, Modal } from '@ui';
import { LIST_ID, START_ID } from './ids';
import { openWalkthrough } from './playback';
import { canRecord, useRecorder } from './recorder';

const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

/** Live summaries, newest first (also those the board doc hasn't heard of, from the server list). */
export function useWalkthroughList(editor: Editor): WalkthroughSummary[] {
  const live = useCollection<WalkthroughSummary | null>(WALKTHROUGHS_COLLECTION);
  const [fetched, setFetched] = useState<WalkthroughSummary[]>([]);
  useEffect(() => {
    editor.host.walkthroughs?.list().then(setFetched, () => undefined);
  }, [editor]);
  const byId = new Map(fetched.map((w) => [w.id, w]));
  for (const [id, w] of live) {
    if (w) byId.set(id, w);
    else byId.delete(id);
  }
  return [...byId.values()].sort((a, b) => b.createdAt - a.createdAt);
}

export const walkthroughLink = (editor: Editor, id: string) => `${window.location.origin}/board/${encodeURIComponent(editor.boardId)}?walkthrough=${encodeURIComponent(id)}`;

export function ListPanel({ editor }: PanelProps) {
  const list = useWalkthroughList(editor);
  const people = usePeople(list.flatMap((w) => (w.authorId ? [w.authorId] : [])));
  const rec = useRecorder();
  const [deleting, setDeleting] = useState<WalkthroughSummary | null>(null);
  const mayRecord = editor.can('editor') && !!editor.host.walkthroughs && editor.host.board.signedIn !== false;

  const copy = async (w: WalkthroughSummary) => {
    try {
      await navigator.clipboard.writeText(walkthroughLink(editor, w.id));
      editor.host.notify('Link copied. People who can open this board can watch it.', 'success');
    } catch {
      editor.host.notify(formatObjectUri({ type: 'walkthrough', id: w.id }), 'info');
    }
  };
  const remove = async () => {
    const w = deleting;
    setDeleting(null);
    if (!w) return;
    try {
      await editor.host.walkthroughs?.remove(w.id);
      editor.host.notify(`Deleted “${w.title}”`, 'success');
    } catch (e) {
      editor.host.notify(e instanceof Error ? e.message : 'Couldn’t delete it', 'error');
    }
  };

  return (
    <div className="fr-walkthrough-list">
      <DockHeader className="fr-walkthrough-list__head">
        <h2 className="fr-walkthrough-list__title">Walkthroughs</h2>
      </DockHeader>
      {mayRecord && (
        <Button variant="primary" icon={Mic} disabled={rec.phase !== 'idle' || !canRecord()} onClick={() => editor.openPanel(START_ID)}>
          Record a walkthrough
        </Button>
      )}
      {!list.length && (
        <p className="fr-walkthrough-list__empty">
          No walkthroughs yet. Record one to talk people through this board: they watch it on the live board, whenever suits them.
        </p>
      )}
      <ul className="fr-walkthrough-list__items">
        {list.map((w) => {
          const author = w.authorId ? people[w.authorId] : undefined;
          const manage = w.authorId === editor.user.id || editor.can('editor');
          return (
            <li key={w.id} className="fr-walkthrough-list__item">
              <button type="button" className="fr-walkthrough-list__play" onClick={() => void openWalkthrough(editor, w.id)} aria-label={`Watch ${w.title}`}>
                <CirclePlay size={28} aria-hidden />
                <span className="fr-walkthrough-list__text">
                  <span className="fr-walkthrough-list__name">
                    {w.media === 'video' && <Video size={13} aria-label="with camera" />} {w.title}
                  </span>
                  <span className="fr-walkthrough-list__meta">
                    {author?.name ?? 'Someone'} · {formatWalkthroughTime(w.durationMs)} · {day.format(w.createdAt)}
                  </span>
                  <span className="fr-walkthrough-list__meta">
                    {w.views} view{w.views === 1 ? '' : 's'} · {w.comments} comment{w.comments === 1 ? '' : 's'}
                    {w.captions ? ' · captions' : ''}
                  </span>
                </span>
              </button>
              <IconButton icon={Link2} size={32} label="Copy link" onClick={() => void copy(w)} />
              {manage && <IconButton icon={Trash2} size={32} label="Delete walkthrough" onClick={() => setDeleting(w)} />}
            </li>
          );
        })}
      </ul>
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title="Delete this walkthrough?"
        description="Its recording, captions and comments go for everyone. This can’t be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void remove()}>
              Delete
            </Button>
          </>
        }
      />
    </div>
  );
}

/** In the top bar while the board has walkthroughs: how many, and the list one click away. */
export function TopbarButton({ editor }: PanelProps) {
  const list = useWalkthroughList(editor);
  const dock = useDock();
  if (!list.length || !editor.host.walkthroughs) return null;
  return (
    <IconButton icon={CirclePlay} label={`Walkthroughs (${list.length})`} active={dock === LIST_ID} onClick={() => editor.openDock(dock === LIST_ID ? null : LIST_ID)}>
      <span className="fr-walkthrough-topbar__count">{list.length}</span>
    </IconButton>
  );
}
