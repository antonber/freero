// The picker's GIF tab (#139): search the operator's GIF provider through `Host.gifs` (the server
// proxies the search and every preview; the browser never contacts the provider). Choosing a GIF
// copies it into the person's uploads first, so what lands on the board is our own file, placed
// like a team sticker (`img:/uploads/<name>.gif`), in its own proportions.
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { GifResult, GifSearchResponse } from '@freero/shared';
import type { Editor, HostGifs } from '@engine';
import { Button, Input, Spinner } from '@ui';
import { customValue } from './custom';

import { t as tr } from '../messages';

const DEBOUNCE_MS = 350;

export function Gifs({ editor, gifs, onPick }: { editor: Editor; gifs: HostGifs; onPick(value: string, name: string, aspect: number): void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState<GifSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [placing, setPlacing] = useState<string | null>(null);
  const asked = useRef(0);

  const load = async (q: string, pos: string | null) => {
    const ask = ++asked.current;
    setLoading(true);
    setFailed(false);
    try {
      const next = await gifs.search(q, pos);
      if (ask !== asked.current) return;
      setPage((prev) => (pos && prev ? { ...next, results: [...prev.results, ...next.results.filter((r) => !prev.results.some((p) => p.id === r.id))] } : next));
    } catch {
      if (ask === asked.current) setFailed(true);
    } finally {
      if (ask === asked.current) setLoading(false);
    }
  };

  // Trending at first; a search once the words settle.
  useEffect(() => {
    const id = setTimeout(() => void load(query.trim(), null), query ? DEBOUNCE_MS : 0);
    return () => clearTimeout(id);
  }, [query]);

  const choose = async (g: GifResult) => {
    if (placing) return;
    setPlacing(g.id);
    try {
      const stored = await gifs.place(g.media);
      onPick(customValue(stored.url), g.title || tr('gif'), stored.w > 0 && stored.h > 0 ? stored.w / stored.h : g.w / g.h);
    } catch (e) {
      editor.host.notify(e instanceof Error && e.message ? e.message : tr('thatDidnTWorkTry'), 'error');
    } finally {
      setPlacing(null);
    }
  };

  const results = page?.results ?? [];
  return (
    <>
      <Input
        size="sm"
        icon={Search}
        placeholder={tr('searchGifs')}
        aria-label={tr('searchGifs')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results[0]) void choose(results[0]);
        }}
      />
      <div className="fr-emoji-picker__scroll" data-fr-scrollable="" aria-busy={loading}>
        {results.length > 0 && (
          <div className="fr-emoji-gifs" role="list" aria-label={query.trim() ? tr('gifsForQuery', { query: query.trim() }) : tr('trendingGifs')}>
            {results.map((g) => (
              <button
                key={g.id}
                type="button"
                role="listitem"
                className="fr-emoji-gifs__item"
                aria-label={g.title || tr('gif')}
                title={g.title || undefined}
                disabled={placing !== null}
                aria-busy={placing === g.id}
                onClick={() => void choose(g)}
              >
                <img src={g.preview.url} alt="" loading="lazy" draggable={false} width={g.preview.w} height={g.preview.h} />
                {placing === g.id && (
                  <span className="fr-emoji-gifs__busy">
                    <Spinner size={16} />
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
        {loading && <Spinner size={16} />}
        {!loading && failed && <div className="fr-emoji-picker__empty">{tr('gifsUnavailable')}</div>}
        {!loading && !failed && page && results.length === 0 && <div className="fr-emoji-picker__empty">{tr('nothingMatchesQuery', { query: query.trim() })}</div>}
        {!loading && page?.next && (
          <Button size="sm" variant="ghost" onClick={() => void load(query.trim(), page.next)}>
            {tr('moreGifs')}
          </Button>
        )}
      </div>
      {page && <div className="fr-emoji-gifs__credit">{tr('gifsFromProvider', { provider: page.provider })}</div>}
    </>
  );
}
