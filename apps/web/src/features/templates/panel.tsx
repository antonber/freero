import { useCallback, useEffect, useMemo, useState } from 'react';
import { BookmarkPlus, LayoutTemplate, Plus, Search, Trash2 } from 'lucide-react';
import { definePanel, useCanEdit, useSelection, type Editor, type SavedTemplateInfo } from '@engine';
import { Button, Input, Spinner, formatShortcut } from '@ui';
import { TEMPLATES } from './lib/catalog';
import { DOCK_ID, insertTemplate } from './lib/insert';
import { filterTemplates } from './lib/place';
import { TemplatePreview } from './lib/Preview';
import { SaveTemplateDialog } from './lib/SaveDialog';
import { SAVE_DIALOG_ID, deleteSavedTemplate, filterSaved, insertSavedTemplate, onSavedTemplatesChanged } from './lib/saved';
import { CATEGORIES, type TemplateCategory, type TemplateDef } from './lib/types';
import './templates.css';

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

function SavedCard({ editor, t, canEdit, onInsert }: { editor: Editor; t: SavedTemplateInfo; canEdit: boolean; onInsert(t: SavedTemplateInfo): void }) {
  const [confirming, setConfirming] = useState(false);
  const [broken, setBroken] = useState(false);
  const mine = t.ownerId === editor.user.id;
  const remove = async () => {
    try {
      await deleteSavedTemplate(editor, t.id);
      editor.host.notify(`Deleted “${t.name}”.`, 'info');
    } catch (err) {
      setConfirming(false);
      editor.host.notify(err instanceof Error && err.message ? err.message : 'Could not delete the template.', 'error');
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
            <Plus size={14} strokeWidth={2.4} /> Add
          </span>
        </span>
        <span className="fr-tpl-card__name">{t.name}</span>
        <span className="fr-tpl-card__desc">{t.description || `${t.elementCount} ${t.elementCount === 1 ? 'item' : 'items'}`}</span>
      </button>
      {mine ? (
        <button type="button" className="fr-tpl-saved__delete" aria-label={`Delete template ${t.name}`} title="Delete template" onClick={() => setConfirming(true)}>
          <Trash2 size={14} />
        </button>
      ) : null}
      {confirming ? (
        <div className="fr-tpl-saved__confirm" role="alertdialog" aria-label={`Delete ${t.name}?`}>
          <span>Delete this template?</span>
          <div>
            <Button size="sm" variant="danger" onClick={() => void remove()} autoFocus>
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
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
  const builtIns = useMemo(
    () => (filter === 'saved' ? [] : filterTemplates(TEMPLATES, query, filter)),
    [query, filter],
  );
  const mine = useMemo(() => (filter === null || filter === 'saved' ? filterSaved(saved ?? [], query) : []), [saved, query, filter]);
  const shownCount = builtIns.length + mine.length;

  const added = useCallback(
    (name: string) => {
      // Close the dock so the zoom-to-fit isn't partly hidden behind it.
      editor.openDock(null);
      editor.host.notify(`Added “${name}”. Press ${formatShortcut('mod+z')} to undo.`, 'success');
    },
    [editor],
  );

  const insert = (def: TemplateDef) => {
    if (insertTemplate(editor, def).length) added(def.name);
  };

  const insertSaved = async (t: SavedTemplateInfo) => {
    try {
      if ((await insertSavedTemplate(editor, t.id)).length) added(t.name);
    } catch (err) {
      editor.host.notify(err instanceof Error && err.message ? err.message : 'Could not add the template.', 'error');
    }
  };

  const saveOpen = () => editor.openPanel(SAVE_DIALOG_ID, { scope: hasSelection ? 'selection' : 'board' });

  return (
    <div className="fr-tpl">
      <header className="fr-tpl__head">
        <h2 className="fr-tpl__title">Templates</h2>
        <p className="fr-tpl__sub">Start from a ready-made layout, or one you saved. Everything stays editable.</p>
      </header>
      <Button size="sm" icon={BookmarkPlus} onClick={saveOpen} className="fr-tpl__save">
        {hasSelection ? 'Save selection as template' : 'Save board as template'}
      </Button>
      <Input
        icon={Search}
        placeholder="Search templates"
        aria-label="Search templates"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && query) {
            e.stopPropagation();
            setQuery('');
          }
          if (e.key === 'Enter' && shownCount === 1 && canEdit) {
            if (mine.length) void insertSaved(mine[0]);
            else insert(builtIns[0]);
          }
        }}
      />
      <div className="fr-tpl__chips" role="group" aria-label="Categories">
        <button type="button" className="fr-tpl-chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          All
        </button>
        <button type="button" className="fr-tpl-chip" aria-pressed={filter === 'saved'} onClick={() => setFilter(filter === 'saved' ? null : 'saved')}>
          Yours
        </button>
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
      {!canEdit && <p className="fr-tpl__note">You can browse templates, but adding them needs edit access.</p>}

      {filter === null || filter === 'saved' ? (
        saved === null ? (
          <div className="fr-tpl__loading">
            <Spinner size={18} />
          </div>
        ) : mine.length ? (
          <section aria-label="Your templates">
            {filter === null ? <h3 className="fr-tpl__section">Your templates</h3> : null}
            <div className="fr-tpl__grid">
              {mine.map((t) => (
                <SavedCard key={t.id} editor={editor} t={t} canEdit={canEdit} onInsert={(x) => void insertSaved(x)} />
              ))}
            </div>
          </section>
        ) : filter === 'saved' && !query ? (
          <div className="fr-tpl__empty">
            <p>You haven’t saved any templates yet. Save this board, or a selection, to reuse it on any board.</p>
            <button type="button" className="fr-tpl__reset" onClick={saveOpen}>
              Save as template
            </button>
          </div>
        ) : null
      ) : null}

      {builtIns.length ? (
        <section aria-label="Freero templates">
          {filter === null && mine.length ? <h3 className="fr-tpl__section">Freero templates</h3> : null}
          <div className="fr-tpl__grid">
            {builtIns.map((t) => (
              <button key={t.id} type="button" className="fr-tpl-card" disabled={!canEdit} title={t.description} onClick={() => insert(t)}>
                <span className="fr-tpl-card__preview">
                  <TemplatePreview def={t} />
                  <span className="fr-tpl-card__add" aria-hidden>
                    <Plus size={14} strokeWidth={2.4} /> Add
                  </span>
                </span>
                <span className="fr-tpl-card__name">{t.name}</span>
                <span className="fr-tpl-card__desc">{t.description}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {shownCount === 0 && query ? (
        <div className="fr-tpl__empty">
          <p>No templates match “{query}”.</p>
          <button
            type="button"
            className="fr-tpl__reset"
            onClick={() => {
              setQuery('');
              setFilter(null);
            }}
          >
            Show all templates
          </button>
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
