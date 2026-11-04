import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { CLOUD_ICON_SOURCE, type CloudIconSetId, type ShapePacksResponse } from '@freero/shared';
import { DockHeader, definePanel, useCanEdit, type Editor, type PanelProps } from '@engine';
import { Button, Input, Select, Spinner } from '@ui';
import type { IconEntry } from './lib/iconIndex';
import { IconSvg } from './lib/nodes';
import { LIBRARY_PANEL, dragPayload, insertIcon, type PlaceableIcon } from './lib/insert';
import { PackManager, UploadPack } from './lib/Packs';
import { CLOUD_SETS, loadCloudPack, type CloudPack } from './lib/cloudPacks';
import { searchPack, type SearchablePack } from './lib/packSearch';

import { t } from './messages';
/** Previews drawn at once; "Show more" adds this many again (the set has ~1,700). */
const PAGE = 240;
/** Which icons the library shows: every source, Freero's own, the cloud sets, one of them, or one workspace pack. */
const ALL = '*';
const FREERO = 'freero';
const CLOUD = CLOUD_ICON_SOURCE;

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

const packHits = (pack: SearchablePack, query: string): Hit[] =>
  searchPack(pack, query).map((ic) => ({ key: ic.id, label: ic.name, icon: { name: ic.name, nodes: ic.nodes, viewBox: ic.viewBox, art: ic.art } }));

/**
 * The cloud sets `wanted` (#4), each fetched the first time it is wanted. `failed`: one didn't
 * arrive (offline); asking again retries it.
 */
function useCloudPacks(wanted: readonly CloudIconSetId[]): { packs: CloudPack[]; pending: boolean; failed: boolean } {
  const [have, setHave] = useState<Partial<Record<CloudIconSetId, CloudPack>>>({});
  const [failed, setFailed] = useState(false);
  const key = wanted.join(',');
  useEffect(() => {
    let live = true;
    setFailed(false);
    for (const id of wanted)
      if (!have[id])
        loadCloudPack(id).then(
          (p) => live && setHave((h) => ({ ...h, [id]: p })),
          () => live && setFailed(true),
        );
    return () => {
      live = false;
    };
  }, [key]);
  const packs = wanted.map((id) => have[id]).filter((p): p is CloudPack => !!p);
  return { packs, pending: packs.length < wanted.length && !failed, failed };
}

/** Where a cloud set comes from, and how its vendor asks it be used: shown wherever its icons are. */
function CloudNotice({ pack }: { pack: CloudPack }) {
  const terms = CLOUD_SETS.find((s) => s.id === pack.cloud)?.terms;
  const notice = { aws: t('cloudNoticeAws'), azure: t('cloudNoticeAzure'), kubernetes: t('cloudNoticeKubernetes') }[pack.cloud];
  return (
    <p className="fr-icons__notice">
      {notice}{' '}
      {terms && (
        <a href={terms} target="_blank" rel="noreferrer noopener">
          {t('cloudTerms', { name: pack.name })}
        </a>
      )}
    </p>
  );
}

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
  const cloudSet = CLOUD_SETS.find((s) => s.pack === source) ?? null;
  // A pack removed meanwhile: back to everything.
  const shownSource = source === ALL || source === FREERO || source === CLOUD || pack || cloudSet ? source : ALL;
  // The cloud sets are chunks of their own: fetched when shown, or when everything is searched.
  const wantedCloud = useMemo(
    () => CLOUD_SETS.filter((s) => shownSource === CLOUD || shownSource === s.pack || (shownSource === ALL && query.trim())).map((s) => s.id),
    [shownSource, query],
  );
  const cloud = useCloudPacks(wantedCloud);
  const sections = useMemo(() => {
    const out: Array<{ id: string; title: string; hits: Hit[]; cloud?: CloudPack }> = [];
    for (const p of list) if (shownSource === ALL || shownSource === p.id) out.push({ id: p.id, title: p.name, hits: packHits(p, query) });
    for (const p of cloud.packs) out.push({ id: p.id, title: p.name, hits: packHits(p, query), cloud: p });
    if (mod && (shownSource === ALL || shownSource === FREERO)) {
      const lucide = mod.searchIcons(mod.iconIndex(), query).map((e: IconEntry): Hit => ({ key: e.name, label: e.name.replace(/-/g, ' '), icon: e }));
      out.push({ id: FREERO, title: t('freeroIcons'), hits: lucide });
    }
    return out.filter((s) => s.hits.length);
  }, [list, mod, query, shownSource, cloud.packs]);
  const total = sections.reduce((n, s) => n + s.hits.length, 0);
  // Paging runs across the sections in order (packs first, then Freero's ~1,700).
  let budget = limit;
  // Freero's own icons are a chunk of their own; a pack shows without it. A cloud set alone waits for its chunk.
  const cloudOnly = shownSource === CLOUD || !!cloudSet;
  const waiting = !packs.data || (cloudOnly ? cloud.pending : !mod && !failed && !pack);
  const unavailable = cloudOnly ? cloud.failed && !cloud.packs.length : failed && !pack;

  return (
    <div className="fr-icons">
      <DockHeader className="fr-icons__head">
        <h2 className="fr-icons__title">{t('icons')}</h2>
        <p className="fr-icons__sub">{t('clickToAddOrDrag')}</p>
      </DockHeader>
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
            ...(CLOUD_SETS.length ? [{ value: CLOUD, label: t('cloudArchitectureIcons') }] : []),
            ...CLOUD_SETS.map((c) => ({ value: c.pack, label: t('packNameCount', { name: c.name, count: c.count }) })),
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
      {unavailable && <p className="fr-icons__note">{t('theIconLibraryCouldnT')}</p>}
      {waiting ? (
        <div className="fr-icons__loading">
          <Spinner />
        </div>
      ) : total === 0 ? (
        !unavailable && <p className="fr-icons__note">{t('noIconsMatchQuery', { query: query.trim() })}</p>
      ) : (
        <>
          <p className="fr-icons__count">{query.trim() ? t('lengthMatches', { length: total }) : t('lengthIcons', { length: total })}</p>
          {sections.map((s) => {
            const shown = s.hits.slice(0, Math.max(0, budget));
            budget -= shown.length;
            if (!shown.length) return null;
            return (
              <section key={s.id} className="fr-icons__section" aria-label={s.title}>
                {(sections.length > 1 || s.cloud) && <h3 className="fr-icons__section-title">{s.title}</h3>}
                {s.cloud && <CloudNotice pack={s.cloud} />}
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
