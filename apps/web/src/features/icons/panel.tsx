import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { definePanel, useCanEdit, type Editor } from '@engine';
import { Button, Input, Spinner } from '@ui';
import type { IconEntry } from './lib/iconIndex';
import { IconSvg } from './lib/nodes';
import { LIBRARY_PANEL, dragPayload, insertIcon } from './lib/insert';

/** Previews drawn at once; "Show more" adds this many again (the set has ~1,700). */
const PAGE = 240;

type IndexModule = typeof import('./lib/iconIndex');
let loading: Promise<IndexModule> | null = null;
/** The icon index is its own chunk, fetched the first time the library opens. */
const loadIndex = () => (loading ??= import('./lib/iconIndex').catch((e) => ((loading = null), Promise.reject(e))));

function IconLibrary({ editor }: { editor: Editor }) {
  const [mod, setMod] = useState<IndexModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const canEdit = useCanEdit();

  useEffect(() => {
    let live = true;
    loadIndex().then(
      (m) => live && setMod(m),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, []);

  const hits = useMemo(() => (mod ? mod.searchIcons(mod.iconIndex(), query) : []), [mod, query]);
  const shown = hits.slice(0, limit);
  // The new icon lands selected in a free spot in view, so no toast is needed.
  const place = (icon: IconEntry) => void insertIcon(editor, icon);

  return (
    <div className="fr-icons">
      <header className="fr-icons__head">
        <h2 className="fr-icons__title">Icons</h2>
        <p className="fr-icons__sub">Click to add, or drag onto the board. Recolour and resize them like any item.</p>
      </header>
      <Input
        autoFocus
        icon={Search}
        placeholder="Search icons"
        aria-label="Search icons"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />
      {!canEdit && <p className="fr-icons__note">You can view this board but not add items.</p>}
      {failed ? (
        <p className="fr-icons__note">The icon library couldn’t load. Check your connection and reopen it.</p>
      ) : !mod ? (
        <div className="fr-icons__loading">
          <Spinner />
        </div>
      ) : hits.length === 0 ? (
        <p className="fr-icons__note">No icons match “{query.trim()}”.</p>
      ) : (
        <>
          <p className="fr-icons__count">{query.trim() ? `${hits.length} match${hits.length === 1 ? '' : 'es'}` : `${hits.length} icons`}</p>
          <div className="fr-icons__grid" role="list">
            {shown.map((icon) => (
              <button
                key={icon.name}
                type="button"
                role="listitem"
                className="fr-icons__item"
                title={icon.name.replace(/-/g, ' ')}
                aria-label={`Add ${icon.name.replace(/-/g, ' ')} icon`}
                disabled={!canEdit}
                draggable={canEdit}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', dragPayload(icon));
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => place(icon)}
              >
                <IconSvg nodes={icon.nodes} color="currentColor" strokeWidth={2} />
              </button>
            ))}
          </div>
          {hits.length > shown.length && (
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              Show more ({hits.length - shown.length} left)
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default definePanel({ id: LIBRARY_PANEL, slot: 'dock-right', order: 60, Component: IconLibrary });
