import { useMemo, useState } from 'react';
import { Plus, Search } from 'lucide-react';
import { definePanel, useCanEdit, type Editor } from '@engine';
import { Input, formatShortcut } from '@ui';
import { TEMPLATES } from './lib/catalog';
import { DOCK_ID, insertTemplate } from './lib/insert';
import { filterTemplates } from './lib/place';
import { TemplatePreview } from './lib/Preview';
import { CATEGORIES, type TemplateCategory, type TemplateDef } from './lib/types';
import './templates.css';

function TemplatesPanel({ editor }: { editor: Editor }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<TemplateCategory | null>(null);
  const canEdit = useCanEdit();
  const shown = useMemo(() => filterTemplates(TEMPLATES, query, category), [query, category]);

  const insert = (def: TemplateDef) => {
    const ids = insertTemplate(editor, def);
    if (!ids.length) return;
    // Close the dock so the zoom-to-fit isn't partly hidden behind it.
    editor.openDock(null);
    editor.host.notify(`Added “${def.name}”. Press ${formatShortcut('mod+z')} to undo.`, 'success');
  };

  return (
    <div className="fr-tpl">
      <header className="fr-tpl__head">
        <h2 className="fr-tpl__title">Templates</h2>
        <p className="fr-tpl__sub">Start from a ready-made layout. Everything stays editable.</p>
      </header>
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
          if (e.key === 'Enter' && shown.length === 1 && canEdit) insert(shown[0]);
        }}
      />
      <div className="fr-tpl__chips" role="group" aria-label="Categories">
        <button type="button" className="fr-tpl-chip" aria-pressed={category === null} onClick={() => setCategory(null)}>
          All
        </button>
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            className="fr-tpl-chip"
            aria-pressed={category === c.id}
            onClick={() => setCategory(category === c.id ? null : c.id)}
          >
            {c.label}
          </button>
        ))}
      </div>
      {!canEdit && <p className="fr-tpl__note">You can browse templates, but adding them needs edit access.</p>}
      {shown.length === 0 ? (
        <div className="fr-tpl__empty">
          <p>No templates match “{query}”.</p>
          <button
            type="button"
            className="fr-tpl__reset"
            onClick={() => {
              setQuery('');
              setCategory(null);
            }}
          >
            Show all templates
          </button>
        </div>
      ) : (
        <div className="fr-tpl__grid">
          {shown.map((t) => (
            <button
              key={t.id}
              type="button"
              className="fr-tpl-card"
              disabled={!canEdit}
              title={t.description}
              onClick={() => insert(t)}
            >
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
      )}
    </div>
  );
}

export default definePanel({
  id: DOCK_ID,
  slot: 'dock-right',
  order: 50,
  Component: TemplatesPanel,
});
