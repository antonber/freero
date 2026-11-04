import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, Building2, LayoutTemplate, Lock, Plus, Search, Trash2, Users } from 'lucide-react';
import { DockHeader, definePanel, useCanEdit, useSelection, type Editor, type SavedTemplateInfo } from '@engine';
import { Button, Input, Spinner, formatShortcut } from '@ui';
import { loadTemplates } from './lib/catalog/load';
import { DOCK_ID, addTemplate } from './lib/insert';
import { filterTemplates } from './lib/place';
import { LazyTemplatePreview } from './lib/Preview';
import { SaveTemplateDialog } from './lib/SaveDialog';
import { SAVE_DIALOG_ID, deleteSavedTemplate, filterSaved, insertSavedTemplate, onSavedTemplatesChanged, setTemplatePublished, setTemplateShared } from './lib/saved';
import { CATEGORIES, type TemplateCategory, type TemplateDef } from './lib/types';
import { t as tr } from './messages';
import './templates.css';

const CATEGORY_LABELS = Object.fromEntries(CATEGORIES.map((c) => [c.id, c.label])) as Record<TemplateCategory, string>;

/** A built-in category, or the user's own saved templates. */
type Filter = TemplateCategory | 'saved' | null;

/** The user's saved templates (null while loading), reloaded after saves/deletes in this tab. */
function useSavedTemplates(editor: Editor): SavedTemplateInfo[] | null {
  const [saved, setSaved] = useState<SavedTemplateInfo[] | null>(null);
  useEffect(() => {
    let live = true;
    const load = () =>
      editor.host
        .listTemplates()
        .then((list) => live && setSaved(list))
        .catch(() => live && setSaved((s) => s ?? []));
    void load();
    const off = onSavedTemplatesChanged(() => void load());
    return () => {
      live = false;
      off();
    };
  }, [editor]);
  return saved;
}

/** The built-in catalog, fetched the first time the picker opens: null while loading, 'failed' when offline. */
function useBuiltInTemplates(): { list: TemplateDef[] | null | 'failed'; retry(): void } {
  const [list, setList] = useState<TemplateDef[] | null | 'failed'>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setList(null);
    loadTemplates().then(
      (all) => live && setList(all),
      () => live && setList('failed'),
    );
    return () => {
      live = false;
    };
  }, [attempt]);
  return { list, retry: () => setAttempt((n) => n + 1) };
}

function SavedCard({ editor, t, canEdit, onInsert }: { editor: Editor; t: SavedTemplateInfo; canEdit: boolean; onInsert(t: SavedTemplateInfo): void }) {
  const [confirming, setConfirming] = useState(false);
  const [broken, setBroken] = useState(false);
  const mine = t.ownerId === editor.user.id;
  const team = editor.host.board.team ?? null;
  const share = async (shared: boolean) => {
    try {
      await setTemplateShared(editor, t.id, shared);
      editor.host.notify(
        shared ? tr('sharedNameWithName2', { name: t.name, name2: team?.name }) : mine ? tr('nameIsPersonalAgain', { name: t.name }) : tr('nameIsNoLongerShared', { name: t.name }),
        'success',
      );
    } catch (err) {
      editor.host.notify(err instanceof Error && err.message ? err.message : tr('couldNotChangeSharing'), 'error');
    }
  };
  const company = team?.company ?? null;
  const publish = async (published: boolean) => {
    try {
      await setTemplatePublished(editor, t.id, published);
      editor.host.notify(published ? tr('publishedNameToCompanyEvery', { name: t.name, company }) : tr('nameIsNoLongerA', { name: t.name, company }), 'success');
    } catch (err) {
      editor.host.notify(err instanceof Error && err.message ? err.message : tr('couldNotChangeIt'), 'error');
    }
  };
  const remove = async () => {
    try {
      await deleteSavedTemplate(editor, t.id);
      editor.host.notify(tr('deletedName', { name: t.name }), 'info');
    } catch (err) {
      setConfirming(false);
      editor.host.notify(err instanceof Error && err.message ? err.message : tr('couldNotDeleteTheTemplate'), 'error');
    }
  };
  return (
    <div className="fr-tpl-saved">
      <button type="button" className="fr-tpl-card" disabled={!canEdit} title={t.description || t.name} onClick={() => onInsert(t)}>
        <span className="fr-tpl-card__preview fr-tpl-card__preview--image">
          {t.thumbnail && !broken ? (
            <img className="fr-tpl-saved__img" src={t.thumbnail} alt="" loading="lazy" draggable={false} onError={() => setBroken(true)} />
          ) : (
            <LayoutTemplate size={28} className="fr-tpl-saved__icon" aria-hidden />
          )}
          <span className="fr-tpl-card__add" aria-hidden>
            <Plus size={14} strokeWidth={2.4} />{' '}{tr('add')}</span>
        </span>
        <span className="fr-tpl-card__name">{t.name}</span>
        <span className="fr-tpl-card__desc">{t.description || `${t.elementCount} ${t.elementCount === 1 ? 'item' : 'items'}`}</span>
        {t.shared && !mine && t.ownerName ? <span className="fr-tpl-card__by">{tr('sharedByOwnername', { ownerName: t.ownerName })}</span> : null}
      </button>
      {t.company ? (
        <span className="fr-tpl-saved__team" title={t.locked ? tr('companyTemplateLockedByIts', { company: t.company }) : tr('companyTemplate', { company: t.company })}>
          {t.locked ? <Lock size={12} aria-hidden /> : <Building2 size={12} aria-hidden />} {t.company}
        </span>
      ) : t.shared ? (
        <span className="fr-tpl-saved__team" title={mine ? tr('sharedWithYourTeam') : tr('sharedByYourTeam')}>
          <Users size={12} aria-hidden />{' '}{tr('team')}</span>
      ) : null}
      {mine && company && editor.host.publishTemplate && !t.locked ? (
        <button
          type="button"
          className="fr-tpl-saved__share fr-tpl-saved__publish"
          aria-label={t.company ? tr('withdrawNameFromCompany', { name: t.name, company }) : tr('publishNameToCompany', { name: t.name, company })}
          title={t.company ? tr('withdrawFromCompany', { company }) : tr('publishToCompany', { company })}
          onClick={() => void publish(!t.company)}
        >
          <Building2 size={14} />
        </button>
      ) : null}
      {mine && team ? (
        <button
          type="button"
          className="fr-tpl-saved__share"
          aria-label={t.shared ? tr('stopSharingNameWithName2', { name: t.name, name2: team.name }) : tr('shareNameWithName2', { name: t.name, name2: team.name })}
          title={t.shared ? tr('stopSharingWithName', { name: team.name }) : tr('shareWithName', { name: team.name })}
          onClick={() => void share(!t.shared)}
        >
          <Users size={14} />
        </button>
      ) : null}
      {!mine && t.shared && t.canUnshare ? (
        <button
          type="button"
          className="fr-tpl-saved__share fr-tpl-saved__share--alone"
          aria-label={tr('stopSharingNameWithThe', { name: t.name })}
          title={tr('stopSharingWithTheTeam')}
          onClick={() => void share(false)}
        >
          <Users size={14} />
        </button>
      ) : null}
      {mine && !t.locked ? (
        <button type="button" className="fr-tpl-saved__delete" aria-label={tr('deleteTemplateName', { name: t.name })} title={tr('deleteTemplate')} onClick={() => setConfirming(true)}>
          <Trash2 size={14} />
        </button>
      ) : null}
      {confirming ? (
        <div className="fr-tpl-saved__confirm" role="alertdialog" aria-label={tr('deleteName', { name: t.name })}>
          <span>{tr('deleteThisTemplate')}</span>
          <div>
            <Button size="sm" variant="danger" onClick={() => void remove()} autoFocus>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{tr('cancel')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TemplatesPanel({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>(null);
  const canEdit = useCanEdit();
  const hasSelection = useSelection().length > 0;
  const saved = useSavedTemplates(editor);
  const catalog = useBuiltInTemplates();
  const all = Array.isArray(catalog.list) ? catalog.list : null;
  const builtIns = useMemo(
    () => (filter === 'saved' || !all ? [] : filterTemplates(all, query, filter, CATEGORY_LABELS)),
    [all, query, filter],
  );
  // Browsing everything: one section per category (each template under its first category).
  // Searching or filtering: one ranked list.
  const groups = useMemo(
    () =>
      filter === null && !query.trim()
        ? CATEGORIES.map((c) => ({ id: c.id, label: c.label, items: builtIns.filter((t) => t.categories[0] === c.id) })).filter((g) => g.items.length)
        : [{ id: 'results', label: '', items: builtIns }],
    [builtIns, filter, query],
  );
  const mine = useMemo(() => (filter === null || filter === 'saved' ? filterSaved(saved ?? [], query) : []), [saved, query, filter]);
  const shownCount = builtIns.length + mine.length;

  const added = useCallback(
    (name: string) => {
      // Close the dock so the zoom-to-fit isn't partly hidden behind it.
      editor.openDock(null);
      editor.host.notify(tr('addedNamePressValueTo', { name, value: formatShortcut('mod+z') }), 'success');
    },
    [editor],
  );

  const insert = async (def: TemplateDef) => {
    try {
      if ((await addTemplate(editor, def)).length) added(def.name);
    } catch {
      editor.host.notify(tr('couldNotLoadNameCheck', { name: def.name }), 'error');
    }
  };

  const insertSaved = async (t: SavedTemplateInfo) => {
    try {
      if ((await insertSavedTemplate(editor, t.id)).length) added(t.name);
    } catch (err) {
      editor.host.notify(err instanceof Error && err.message ? err.message : tr('couldNotAddTheTemplate'), 'error');
    }
  };

  const saveOpen = () => editor.openPanel(SAVE_DIALOG_ID, { scope: hasSelection ? 'selection' : 'board' });

  return (
    <div className="fr-tpl">
      <DockHeader className="fr-tpl__head">
        <h2 className="fr-tpl__title">{tr('templates2')}</h2>
        <p className="fr-tpl__sub">{tr('startFromAReadyMade')}</p>
      </DockHeader>
      <Button size="sm" icon={BookmarkPlus} onClick={saveOpen} className="fr-tpl__save">
        {hasSelection ? tr('saveSelectionAsTemplate') : tr('saveBoardAsTemplate2')}
      </Button>
      <Input
        icon={Search}
        placeholder={tr('searchTemplates')}
        aria-label={tr('searchTemplates')}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation();
            setQuery('');
          }
          if (e.key === 'Enter' && shownCount === 1 && canEdit) {
            if (mine.length) void insertSaved(mine[0]);
            else void insert(builtIns[0]);
          }
        }}
      />
      <div className="fr-tpl__chips" role="group" aria-label={tr('categories')}>
        <button type="button" className="fr-tpl-chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>{tr('all')}</button>
        <button type="button" className="fr-tpl-chip" aria-pressed={filter === 'saved'} onClick={() => setFilter(filter === 'saved' ? null : 'saved')}>{tr('saved')}</button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="fr-tpl-chip"
            aria-pressed={filter === c.id}
            onClick={() => setFilter(filter === c.id ? null : c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!canEdit && <p className="fr-tpl__note">{tr('youCanBrowseTemplatesBut')}</p>}

      {filter === null || filter === 'saved' ? (
        saved === null ? (
          <div className="fr-tpl__loading">
            <Spinner size={18} />
          </div>
        ) : mine.length ? (
          <section aria-label={tr('savedTemplates')}>
            {filter === null ? <h3 className="fr-tpl__section">{tr('savedTemplates')}</h3> : null}
            <div className="fr-tpl__grid">
              {mine.map((t) => (
                <SavedCard key={t.id} editor={editor} t={t} canEdit={canEdit} onInsert={(x) => void insertSaved(x)} />
              ))}
            </div>
          </section>
        ) : filter === 'saved' && !query ? (
          <div className="fr-tpl__empty">
            <p>{tr('youHavenTSavedAny')}</p>
            <button type="button" className="fr-tpl__reset" onClick={saveOpen}>{tr('saveAsTemplate2')}</button>
          </div>
        ) : null
      ) : null}

      {filter !== 'saved' && catalog.list === null ? (
        <div className="fr-tpl__loading">
          <Spinner size={18} />
        </div>
      ) : filter !== 'saved' && catalog.list === 'failed' ? (
        <div className="fr-tpl__empty">
          <p>{tr('couldnTLoadFreeroS')}</p>
          <button type="button" className="fr-tpl__reset" onClick={catalog.retry}>{tr('tryAgain')}</button>
        </div>
      ) : null}

      {groups.map((g) =>
        g.items.length ? (
          <section key={g.id} aria-label={g.label || tr('freeroTemplates')}>
            {g.label ? (
              <h3 className="fr-tpl__section">
                {g.label} <span className="fr-tpl__count">{g.items.length}</span>
              </h3>
            ) : filter === null && mine.length ? (
              <h3 className="fr-tpl__section">{tr('freeroTemplates')}</h3>
            ) : null}
            <div className="fr-tpl__grid">
              {g.items.map((t) => (
                <button key={t.id} type="button" className="fr-tpl-card" disabled={!canEdit} title={t.description} onClick={() => void insert(t)}>
                  <span className="fr-tpl-card__preview">
                    <LazyTemplatePreview def={t} />
                    <span className="fr-tpl-card__add" aria-hidden>
                      <Plus size={14} strokeWidth={2.4} />{' '}{tr('add')}</span>
                  </span>
                  <span className="fr-tpl-card__name">{t.name}</span>
                  <span className="fr-tpl-card__desc">{t.description}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null,
      )}

      {shownCount === 0 && query && (all || filter === 'saved') ? (
        <div className="fr-tpl__empty">
          <p>{tr('noTemplatesMatchQuery', { query })}</p>
          <button
            type="button"
            className="fr-tpl__reset"
            onClick={() => {
              setQuery('');
              setFilter(null);
            }}
          >{tr('showAllTemplates')}</button>
        </div>
      ) : null}
    </div>
  );
}

export default [
  definePanel({ id: DOCK_ID, slot: 'dock-right', order: 50, Component: TemplatesPanel }),
  // Saving copies the content into the user's own library; it never writes the board.
  definePanel({ id: SAVE_DIALOG_ID, slot: 'dialog', order: 50, minRole: 'viewer', Component: SaveTemplateDialog }),
];
