// "Linked from" (KAI-149): other boards whose content points at this board or anything on it — item
// links, smart links, addresses in text and comments. The server lists only sources the viewer may
// open, so the list never names a board they can't see.
import { useEffect, useState } from 'react';
import { LayoutDashboard } from 'lucide-react';
import { formatObjectUri, type Backlink, type ReferenceKind } from '@freero/shared';
import { api } from '../api/client';

const KIND_LABEL: Record<ReferenceKind, string> = { link: 'item link', embed: 'smart link', mention: 'mention', comment: 'comment', tracker: 'tracker issue' };

/** One row per source board: how many places there point here, and how. */
function bySourceBoard(links: Backlink[], selfId: string) {
  const boards = new Map<string, { id: string; title: string; path: string; count: number; kinds: Set<ReferenceKind> }>();
  for (const l of links) {
    if (l.board.id === selfId) continue; // links within this board aren't "from" anywhere
    const b = boards.get(l.board.id) ?? { id: l.board.id, title: l.board.title, path: l.source.path, count: 0, kinds: new Set<ReferenceKind>() };
    b.count++;
    for (const k of l.kinds) b.kinds.add(k);
    boards.set(l.board.id, b);
  }
  return [...boards.values()];
}

export function LinkedFrom({ boardId, onOpen }: { boardId: string; onOpen: (path: string) => void }) {
  const [links, setLinks] = useState<Backlink[] | null>(null);
  useEffect(() => {
    let live = true;
    setLinks(null);
    api.backlinks(formatObjectUri({ type: 'board', id: boardId })).then(
      (r) => live && setLinks(r.backlinks),
      () => live && setLinks([]),
    );
    return () => {
      live = false;
    };
  }, [boardId]);
  if (links === null) return null;
  const rows = bySourceBoard(links, boardId);
  return (
    <section aria-label="Linked from" className="fr-share__linked">
      <h3 className="fr-share__heading">Linked from</h3>
      {rows.length === 0 ? (
        <p className="fr-share__linked-empty">No other board you can open links here yet.</p>
      ) : (
        <ul className="fr-share__members">
          {rows.map((b) => (
            <li key={b.id}>
              <button type="button" className="fr-share__linked-row" onClick={() => onOpen(b.path)}>
                <span className="fr-share__link-icon" aria-hidden>
                  <LayoutDashboard size={16} />
                </span>
                <span className="fr-share__who">
                  <span className="fr-share__name">{b.title}</span>
                  <span className="fr-share__email-text">
                    {b.count === 1 ? '1 place' : `${b.count} places`} · {[...b.kinds].map((k) => KIND_LABEL[k]).join(', ')}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
