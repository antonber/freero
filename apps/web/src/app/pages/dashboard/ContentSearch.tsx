// "Inside boards" on the dashboard (KAI-141, KAI-151): what the boards of this workspace SAY that
// matches the search — titles, notes, cards, frame titles, table cells, tags, comments — grouped by
// board, each opening the board at that item (or that comment thread). The server answers only
// from boards the person can open now, and only with content every reader of the board sees.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Columns3,
  FileText,
  Frame,
  GitBranch,
  LayoutDashboard,
  MessageSquare,
  RotateCw,
  Search,
  Shapes,
  SquareCheckBig,
  StickyNote,
  Table2,
  Type,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import type { SearchHit } from '@freero/shared';
import { Button, Spinner } from '@ui';
import { api } from '../../api/client';
import { t } from './messages';
import './search.css';

const ITEM: Record<string, { label: string; icon: LucideIcon }> = {
  sticky: { label: t('stickyNote'), icon: StickyNote },
  text: { label: t('text'), icon: Type },
  shape: { label: t('shape'), icon: Shapes },
  card: { label: t('card'), icon: SquareCheckBig },
  frame: { label: t('frame'), icon: Frame },
  table: { label: t('table'), icon: Table2 },
  kanban: { label: t('kanban'), icon: Columns3 },
  mindmap: { label: t('mindMap'), icon: GitBranch },
  connector: { label: t('connector'), icon: Workflow },
};
const describe = (h: SearchHit): { label: string; icon: LucideIcon } =>
  h.kind === 'board'
    ? h.objectKind === 'doc'
      ? { label: t('docName'), icon: FileText }
      : { label: t('boardName'), icon: LayoutDashboard }
    : h.kind === 'comment'
      ? { label: t('comment'), icon: MessageSquare }
      : h.objectKind === 'doc'
        ? { label: t('inTheDoc'), icon: FileText }
        : (ITEM[h.itemType ?? ''] ?? { label: t('item'), icon: Shapes });

/** The snippet with its matched words marked (React escapes the text: board content is untrusted). */
function Snippet({ hit }: { hit: SearchHit }) {
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const [i, r] of hit.highlights.entries()) {
    if (r.start > at) parts.push(hit.snippet.slice(at, r.start));
    parts.push(<mark key={i}>{hit.snippet.slice(r.start, r.end)}</mark>);
    at = r.end;
  }
  parts.push(hit.snippet.slice(at));
  return <span className="fr-dash-search__snippet">{parts}</span>;
}

/** Runs the search for `q` in the workspace and reports how many matches came back (the tab count). */
export function useContentSearch(q: string, workspaceId: string | null) {
  const [state, setState] = useState<{ hits: SearchHit[] | null; cursor: string | null; failed: boolean; loadingMore: boolean }>({ hits: null, cursor: null, failed: false, loadingMore: false });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setState({ hits: null, cursor: null, failed: false, loadingMore: false });
    if (!q) return;
    api.search(q, { workspace: workspaceId ?? undefined }).then(
      (r) => live && setState({ hits: r.hits, cursor: r.nextCursor, failed: false, loadingMore: false }),
      () => live && setState({ hits: [], cursor: null, failed: true, loadingMore: false }),
    );
    return () => {
      live = false;
    };
  }, [q, workspaceId, attempt]);
  const loadMore = () => {
    if (!state.cursor || state.loadingMore) return;
    const cursor = state.cursor;
    setState((s) => ({ ...s, loadingMore: true }));
    api.search(q, { workspace: workspaceId ?? undefined, cursor }).then(
      (r) => setState((s) => ({ hits: [...(s.hits ?? []), ...r.hits], cursor: r.nextCursor, failed: false, loadingMore: false })),
      () => setState((s) => ({ ...s, loadingMore: false })),
    );
  };
  return { ...state, loadMore, retry: () => setAttempt((n) => n + 1) };
}

export function ContentSearch({ q, search }: { q: string; search: ReturnType<typeof useContentSearch> }) {
  const navigate = useNavigate();
  const { hits, failed, cursor, loadingMore } = search;
  if (hits === null)
    return (
      <div className="fr-dash-search__loading">
        <Spinner size={20} />
      </div>
    );
  if (failed)
    return (
      <div className="fr-empty">
        <h2 className="fr-empty__title">{t('couldnTSearchInsideYour')}</h2>
        <p className="fr-empty__body">{t('checkYourConnectionAndTry')}</p>
        <Button icon={RotateCw} onClick={search.retry}>{t('tryAgain')}</Button>
      </div>
    );
  if (!hits.length)
    return (
      <div className="fr-empty">
        <span className="fr-empty__badge">
          <Search size={22} />
        </span>
        <h2 className="fr-empty__title">{t('nothingInsideYourBoardsSays', { q })}</h2>
        <p className="fr-empty__body">{t('searchLooksAtBoardNames')}</p>
      </div>
    );

  // Grouped by board, in the order their best match came.
  const groups = new Map<string, { title: string; hits: SearchHit[] }>();
  for (const h of hits) {
    const g = groups.get(h.board.id) ?? { title: h.board.title, hits: [] };
    g.hits.push(h);
    groups.set(h.board.id, g);
  }
  return (
    <div className="fr-dash-search">
      {[...groups].map(([boardId, g]) => {
        const titleHit = g.hits.find((h) => h.kind === 'board');
        // A doc's hits (KAI-162) open the doc.
        const isDoc = g.hits.some((h) => h.objectKind === 'doc');
        return (
        <section key={boardId} className="fr-dash-search__board" aria-label={g.title || (isDoc ? t('untitledDoc') : t('untitledBoard'))}>
          <button type="button" className="fr-dash-search__board-head" onClick={() => navigate(`/${isDoc ? 'doc' : 'board'}/${encodeURIComponent(boardId)}`)}>
            {isDoc ? <FileText size={16} aria-hidden /> : <LayoutDashboard size={16} aria-hidden />}
            <span className="fr-dash-search__board-title">{titleHit ? <Snippet hit={titleHit} /> : g.title || t('untitledBoard')}</span>
            <span className="fr-dash-search__count">
              {g.hits.length} {g.hits.length === 1 ? 'match' : 'matches'}
            </span>
          </button>
          <ul className="fr-dash-search__hits">
            {g.hits
              .filter((h) => h.kind !== 'board')
              .map((h) => {
                const d = describe(h);
                return (
                  <li key={h.uri + (h.threadId ?? '') + h.snippet}>
                    <button type="button" className="fr-dash-search__hit" onClick={() => navigate(h.path)} data-testid="search-hit">
                      <span className="fr-dash-search__kind">
                        <d.icon size={15} aria-hidden />
                        {d.label}
                      </span>
                      <Snippet hit={h} />
                    </button>
                  </li>
                );
              })}
          </ul>
        </section>
        );
      })}
      {cursor ? (
        <div className="fr-dash-search__more">
          <Button variant="secondary" loading={loadingMore} onClick={search.loadMore}>{t('showMoreMatches')}</Button>
        </div>
      ) : null}
    </div>
  );
}
