import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { DockHeader, definePanel, useCanEdit, type Editor } from '@engine';
import { Button, Input, Spinner } from '@ui';
import type { IconEntry } from './lib/iconIndex';
import { IconSvg } from './lib/nodes';
import { LIBRARY_PANEL, dragPayload, insertIcon } from './lib/insert';

import { t } from './messages';
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
      <DockHeader className="fr-icons__head">
        <h2 className="fr-icons__title">{t('icons')}</h2>
        <p className="fr-icons__sub">{t('clickToAddOrDrag')}</p>
      </DockHeader>
      <Input
        autoFocus
        icon={Search}
        placeholder={t('searchIcons')}
        aria-label={t('searchIcons')}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setLimit(PAGE);
        }}
      />
      {!canEdit && <p className="fr-icons__note">{t('youCanViewThisBoard')}</p>}
      {failed ? (
        <p className="fr-icons__note">{t('theIconLibraryCouldnT')}</p>
      ) : !mod ? (
        <div className="fr-icons__loading">
          <Spinner />
        </div>
      ) : hits.length === 0 ? (
        <p className="fr-icons__note">{t('noIconsMatchQuery', { query: query.trim() })}</p>
      ) : (
        <>
          <p className="fr-icons__count">{query.trim() ? t('lengthMatches', { length: hits.length }) : t('lengthIcons', { length: hits.length })}</p>
          <div className="fr-icons__grid" role="list">
            {shown.map((icon) => (
              <button
                key={icon.name}
                type="button"
                role="listitem"
                className="fr-icons__item"
                title={icon.name.replace(/-/g, ' ')}
                aria-label={t('addReplaceIcon', { replace: icon.name.replace(/-/g, ' ') })}
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
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>{t('showMore')}{hits.length - shown.length}{' '}{t('left')}</Button>
          )}
        </>
      )}
    </div>
  );
}

export default definePanel({ id: LIBRARY_PANEL, slot: 'dock-right', order: 60, Component: IconLibrary });
