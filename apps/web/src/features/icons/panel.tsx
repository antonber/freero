import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { iconWords, type ShapePack, type ShapePacksResponse } from '@freero/shared';
import { DockHeader, definePanel, useCanEdit, type Editor, type PanelProps } from '@engine';
import { Button, Input, Select, Spinner } from '@ui';
import type { IconEntry } from './lib/iconIndex';
import { IconSvg } from './lib/nodes';
import { LIBRARY_PANEL, dragPayload, insertIcon, type PlaceableIcon } from './lib/insert';
import { PackManager, UploadPack } from './lib/Packs';

import { t } from './messages';
/** Previews drawn at once; "Show more" adds this many again (the set has ~1,700). */
const PAGE = 240;
/** Which icons the library shows: every source, Freero's own, or one workspace pack. */
const ALL = '*';
const FREERO = 'freero';

type IndexModule = typeof import('./lib/iconIndex');
let loading: Promise<IndexModule> | null = null;
/** The icon index is its own chunk, fetched the first time the library opens. */
const loadIndex = () => (loading ??= import('./lib/iconIndex').catch((e) => ((loading = null), Promise.reject(e))));

interface Hit {
  key: string;
  label: string;
  icon: PlaceableIcon;
}

function Tile({ editor, hit, canEdit }: { editor: Editor; hit: Hit; canEdit: boolean }) {
  return (
    <button
      type="button"
      role="listitem"
      className="fr-icons__item"
      title={hit.label}
      aria-label={t('addReplaceIcon', { replace: hit.label })}
      disabled={!canEdit}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', dragPayload(hit.icon));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      // The new icon lands selected in a free spot in view, so no toast is needed.
      onClick={() => void insertIcon(editor, hit.icon)}
    >
      <IconSvg nodes={hit.icon.nodes} color="currentColor" strokeWidth={2} viewBox={hit.icon.viewBox} art={hit.icon.art} />
    </button>
  );
}

/** The workspace's shape packs and the person's own (#4), read once per opening of the library. */
function usePacks(editor: Editor): { data: ShapePacksResponse | null; reload: () => void } {
  const none: ShapePacksResponse = { packs: [], canManage: false };
  const [data, setData] = useState<ShapePacksResponse | null>(editor.host.shapePacks ? null : none);
  const [rev, setRev] = useState(0);
  useEffect(() => {
    let live = true;
    editor.host.shapePacks?.list().then(
      (d) => live && setData(d),
      // No packs is the same library as before: Freero's own icons still work.
      () => live && setData({ packs: [], canManage: false }),
    );
    return () => {
      live = false;
    };
  }, [editor, rev]);
  return { data, reload: useCallback(() => setRev((r) => r + 1), []) };
}

const packHits = (pack: ShapePack, query: string): Hit[] => {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const packWords = iconWords(pack.name);
  return pack.icons
    .filter((ic) => {
      const hay = `${iconWords(ic.name)} ${packWords}`;
      return words.every((w) => hay.includes(w));
    })
    .map((ic) => ({ key: ic.id, label: ic.name, icon: { name: ic.name, nodes: ic.nodes, viewBox: ic.viewBox, art: ic.art } }));
};

function IconLibrary({ editor, props }: PanelProps) {
  const [mod, setMod] = useState<IndexModule | null>(null);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState(typeof props?.query === 'string' ? props.query : '');
  const [source, setSource] = useState<string>(typeof props?.pack === 'string' ? props.pack : ALL);
  const [limit, setLimit] = useState(PAGE);
  const canEdit = useCanEdit();
  const packs = usePacks(editor);

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

  const list = packs.data?.packs ?? [];
  const pack = list.find((p) => p.id === source) ?? null;
  // A pack removed meanwhile: back to everything.
  const shownSource = source === ALL || source === FREERO || pack ? source : ALL;
  const sections = useMemo(() => {
    const out: Array<{ id: string; title: string; hits: Hit[] }> = [];
    for (const p of list) if (shownSource === ALL || shownSource === p.id) out.push({ id: p.id, title: p.name, hits: packHits(p, query) });
    if (mod && (shownSource === ALL || shownSource === FREERO)) {
      const lucide = mod.searchIcons(mod.iconIndex(), query).map((e: IconEntry): Hit => ({ key: e.name, label: e.name.replace(/-/g, ' '), icon: e }));
      out.push({ id: FREERO, title: t('freeroIcons'), hits: lucide });
    }
    return out.filter((s) => s.hits.length);
  }, [list, mod, query, shownSource]);
  const total = sections.reduce((n, s) => n + s.hits.length, 0);
  // Paging runs across the sections in order (packs first, then Freero's ~1,700).
  let budget = limit;
  // Freero's own icons are a chunk of their own; a pack shows without it.
  const waiting = !packs.data || (!mod && !failed && !pack);

  return (
    <div className="fr-icons">
      <DockHeader className="fr-icons__head">
        <h2 className="fr-icons__title">{t('icons')}</h2>
        <p className="fr-icons__sub">{t('clickToAddOrDrag')}</p>
      </DockHeader>
      {(list.length > 0 || (packs.data && editor.host.shapePacks)) && (
        <div className="fr-icons__source">
          <Select<string>
            aria-label={t('whichIcons')}
            size="sm"
            width="100%"
            value={shownSource}
            onChange={(v) => {
              setSource(v);
              setLimit(PAGE);
            }}
            options={[
              { value: ALL, label: t('allIcons') },
              { value: FREERO, label: t('freeroIcons') },
              ...list.map((p) => ({ value: p.id, label: p.personal ? t('myPackNameCount', { name: p.name, count: p.icons.length }) : t('packNameCount', { name: p.name, count: p.icons.length }) })),
            ]}
          />
          {packs.data && editor.host.shapePacks && (
            <UploadPack
              host={editor.host.shapePacks}
              notify={editor.host.notify}
              canShare={packs.data.canManage}
              onCreated={(id) => {
                packs.reload();
                setSource(id);
              }}
            />
          )}
        </div>
      )}
      {pack && (pack.personal || packs.data?.canManage) && editor.host.shapePacks && (
        <PackManager host={editor.host.shapePacks} notify={editor.host.notify} pack={pack} onChanged={packs.reload} onRemoved={() => (setSource(ALL), packs.reload())} />
      )}
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
      {failed && !pack && <p className="fr-icons__note">{t('theIconLibraryCouldnT')}</p>}
      {waiting ? (
        <div className="fr-icons__loading">
          <Spinner />
        </div>
      ) : total === 0 ? (
        !(failed && !pack) && <p className="fr-icons__note">{t('noIconsMatchQuery', { query: query.trim() })}</p>
      ) : (
        <>
          <p className="fr-icons__count">{query.trim() ? t('lengthMatches', { length: total }) : t('lengthIcons', { length: total })}</p>
          {sections.map((s) => {
            const shown = s.hits.slice(0, Math.max(0, budget));
            budget -= shown.length;
            if (!shown.length) return null;
            return (
              <section key={s.id} className="fr-icons__section" aria-label={s.title}>
                {sections.length > 1 && <h3 className="fr-icons__section-title">{s.title}</h3>}
                <div className="fr-icons__grid" role="list">
                  {shown.map((hit) => (
                    <Tile key={hit.key} editor={editor} hit={hit} canEdit={canEdit} />
                  ))}
                </div>
              </section>
            );
          })}
          {total > limit && (
            <Button variant="secondary" size="sm" onClick={() => setLimit((l) => l + PAGE)}>
              {t('showMoreCount', { count: total - limit })}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

export default definePanel({ id: LIBRARY_PANEL, slot: 'dock-right', order: 60, Component: IconLibrary });
