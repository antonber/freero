import { useMemo, useState } from 'react';
import { Search, SlidersHorizontal } from 'lucide-react';
import { DockHeader, definePanel, useCanEdit, useCollection, type Editor } from '@engine';
import { Input, Toggle } from '@ui';
import { LIBRARY_COLLECTION, SHAPE_SETS, enabledSets, searchShapes, type LibraryShape } from './lib/library';
import { encodeDrag, insertShape } from './lib/insert';
import { LIBRARY_PANEL_ID } from './lib/constants';
import { ShapeIcon } from './lib/ShapeIcon';
import './library.css';

function Tile({ editor, shape, canEdit }: { editor: Editor; shape: LibraryShape; canEdit: boolean }) {
  return (
    <button
      type="button"
      className="fr-shape-lib__tile"
      title={shape.label}
      aria-label={shape.label}
      disabled={!canEdit}
      draggable={canEdit}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', encodeDrag(shape));
        e.dataTransfer.effectAllowed = 'copy';
      }}
      onClick={() => insertShape(editor, shape)}
    >
      <ShapeIcon kind={shape.kind} size={30} strokeWidth={1.4} />
      <span className="fr-shape-lib__name">{shape.label}</span>
    </button>
  );
}

/** Searchable library of shape sets; which sets show is a per-board choice. */
function ShapeLibraryPanel({ editor }: { editor: Editor }) {
  const canEdit = useCanEdit();
  const choices = useCollection<boolean>(LIBRARY_COLLECTION);
  const [query, setQuery] = useState('');
  const [managing, setManaging] = useState(false);
  const sets = useMemo(() => enabledSets(choices), [choices]);
  const groups = useMemo(() => searchShapes(sets, query), [sets, query]);
  const on = new Set(sets.map((s) => s.id));

  return (
    <div className="fr-shape-lib">
      <DockHeader className="fr-shape-lib__head">
        <h2 className="fr-shape-lib__title">Shapes</h2>
        <button
          type="button"
          className={`fr-shape-lib__manage${managing ? ' is-active' : ''}`}
          aria-expanded={managing}
          onClick={() => setManaging((m) => !m)}
        >
          <SlidersHorizontal size={14} aria-hidden />
          Libraries
        </button>
      </DockHeader>
      {managing && (
        <ul className="fr-shape-lib__sets" aria-label="Shape libraries on this board">
          {SHAPE_SETS.map((set) => (
            <li key={set.id} className="fr-shape-lib__set">
              <span>
                <strong>{set.label}</strong>
                <small>{set.description}</small>
              </span>
              <Toggle
                checked={on.has(set.id)}
                disabled={!canEdit}
                aria-label={`Show ${set.label} shapes on this board`}
                onChange={(next: boolean) => editor.collection<boolean>(LIBRARY_COLLECTION).set(set.id, next)}
              />
            </li>
          ))}
        </ul>
      )}
      <label className="fr-shape-lib__search">
        <Search size={15} aria-hidden />
        <Input value={query} placeholder="Search shapes" aria-label="Search shapes" onChange={(e) => setQuery(e.target.value)} />
      </label>
      {groups.map(({ set, shapes }) => (
        <section key={set.id} className="fr-shape-lib__group" aria-label={set.label}>
          <h3 className="fr-shape-lib__group-title">{set.label}</h3>
          <div className="fr-shape-lib__grid">
            {shapes.map((s) => (
              <Tile key={`${set.id}:${s.label}`} editor={editor} shape={s} canEdit={canEdit} />
            ))}
          </div>
        </section>
      ))}
      {!groups.length && (
        <p className="fr-shape-lib__empty">
          {sets.length ? `No shapes match “${query}”.` : 'No shape libraries are on for this board.'}
        </p>
      )}
    </div>
  );
}

export default definePanel({
  id: LIBRARY_PANEL_ID,
  slot: 'dock-right',
  order: 40,
  Component: ShapeLibraryPanel,
});
