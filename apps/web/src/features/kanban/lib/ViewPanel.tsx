// The View panel (dock): how a kanban's board view shows its cards. Which fields show (and their
// order) and what colours cards are this person's own until an editor presses "Save for
// everyone"; viewers change them for themselves too. Density changes card sizes on the shared
// board, so only editors change it, for everyone. Shows the kanban the selection points at, and
// keeps showing it when the selection moves elsewhere.
import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, SlidersHorizontal } from 'lucide-react';
import {
  SHOWABLE_BUILTINS,
  boardView,
  collectionSchema,
  colorableFields,
  overrideBetween,
  withOverride,
  type CardColorBy,
  type CardDensity,
  type KanbanElement,
} from '@freero/shared';
import { DockHeader, richTextToPlain, useCanEdit, useElement, usePersonalView, useSelection, type Editor } from '@engine';
import { Button, IconButton, SegmentedControl, Select, Toggle } from '@ui';
import { fieldsTarget } from './schema';
import { resetMyView, saveViewForEveryone, setDensity, setMyCardDisplay } from './view';

const DENSITIES: Array<{ value: CardDensity; label: string }> = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
];

export function ViewPanel({ editor }: { editor: Editor }) {
  const selection = useSelection();
  const canEdit = useCanEdit();
  const [kid, setKid] = useState<string | null>(() => fieldsTarget(editor)?.id ?? null);
  useEffect(() => {
    const t = fieldsTarget(editor);
    if (t) setKid(t.id);
  }, [editor, selection]);
  const found = useElement(kid);
  const k = found?.type === 'kanban' ? (found as KanbanElement) : null;
  const saved = k ? boardView(k) : null;
  const override = usePersonalView(k?.id, saved?.id ?? '');
  if (!k || !saved) {
    return (
      <div className="fr-kanban-fields">
        <DockHeader className="fr-kanban-fields__head">
          <h2 className="fr-kanban-fields__title">View</h2>
        </DockHeader>
        <div className="fr-kanban-fields__empty">
          <SlidersHorizontal size={28} strokeWidth={1.5} aria-hidden />
          <strong>Select a kanban board</strong>
          <span>Choose what its cards show and how they are coloured.</span>
        </div>
      </div>
    );
  }
  const mine = withOverride(saved, override);
  const own = !!overrideBetween(saved, mine);
  const schema = collectionSchema(k);
  const card = mine.card!;
  const mayShare = canEdit && !k.locked;
  // Every field a card can show: the ones shown first, in their order, then the rest.
  const all = [...SHOWABLE_BUILTINS.map((f) => ({ id: f.id as string, name: f.name })), ...schema.map((f) => ({ id: f.id, name: f.name }))];
  const shown = card.show.map((id) => all.find((f) => f.id === id)).filter((f): f is { id: string; name: string } => !!f);
  const rest = all.filter((f) => !card.show.includes(f.id));
  const setShow = (show: string[]) => setMyCardDisplay(editor, k.id, { show });
  const groupName = schema[0]?.name ?? 'Stage';
  const colorChoices: Array<{ value: CardColorBy; label: string }> = [
    { value: 'group', label: `Column (${groupName})` },
    { value: 'own', label: 'Card’s own colour' },
    { value: '$status', label: 'Status' },
    ...colorableFields(schema).map((f) => ({ value: f.id, label: f.name })),
  ];

  return (
    <div className="fr-kanban-fields fr-kanban-view">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">View</h2>
        <span className="fr-kanban-fields__of">{richTextToPlain(k.title) || 'Kanban'}</span>
      </DockHeader>
      <div className={`fr-kanban-view__whose${own ? ' is-own' : ''}`} role="status">
        {own ? (
          <>
            <span>Only you see these changes.</span>
            <span className="fr-kanban-view__whose-actions">
              {mayShare && (
                <Button size="sm" variant="primary" onClick={() => saveViewForEveryone(editor, k.id)}>
                  Save for everyone
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => resetMyView(editor, k.id)}>
                Reset
              </Button>
            </span>
          </>
        ) : (
          <span>{mayShare ? 'Everyone sees this view. Your changes stay yours until you save them.' : 'Changes you make here are yours alone.'}</span>
        )}
      </div>

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-cards">
        <h3 id="fr-kanban-view-cards" className="fr-kanban-view__heading">
          Cards
        </h3>
        <label className="fr-kanban-view__row">
          <span>Density</span>
          {mayShare ? (
            <SegmentedControl size="sm" aria-label="Card density" value={card.density} options={DENSITIES} onChange={(d) => setDensity(editor, k.id, d)} />
          ) : (
            <span className="fr-kanban-view__value">{DENSITIES.find((d) => d.value === card.density)?.label}</span>
          )}
        </label>
        <p className="fr-kanban-fields__hint">{mayShare ? 'Density changes card sizes for everyone.' : 'Density is set by the board’s editors.'}</p>
        <label className="fr-kanban-view__row">
          <span>Colour by</span>
          <Select<CardColorBy>
            size="sm"
            aria-label="Colour cards by"
            value={colorChoices.some((c) => c.value === card.color) ? card.color : 'own'}
            options={colorChoices}
            onChange={(color) => setMyCardDisplay(editor, k.id, { color })}
          />
        </label>
      </section>

      <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-fields">
        <h3 id="fr-kanban-view-fields" className="fr-kanban-view__heading">
          Fields on cards
        </h3>
        <ol className="fr-kanban-fields__list fr-kanban-view__fields" aria-label="Fields on cards">
          {shown.map((f, i) => (
            <li key={f.id} className="fr-kanban-view__field">
              <Toggle size="sm" checked label={f.name} onChange={() => setShow(card.show.filter((id) => id !== f.id))} />
              <span className="fr-kanban-view__move">
                <IconButton
                  icon={ChevronUp}
                  size={32}
                  label={`Show ${f.name} earlier`}
                  disabled={i === 0}
                  onClick={() => setShow(swap(shown.map((x) => x.id), i, i - 1))}
                />
                <IconButton
                  icon={ChevronDown}
                  size={32}
                  label={`Show ${f.name} later`}
                  disabled={i === shown.length - 1}
                  onClick={() => setShow(swap(shown.map((x) => x.id), i, i + 1))}
                />
              </span>
            </li>
          ))}
          {rest.map((f) => (
            <li key={f.id} className="fr-kanban-view__field">
              <Toggle size="sm" checked={false} label={f.name} onChange={() => setShow([...shown.map((x) => x.id), f.id])} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function swap(ids: string[], i: number, j: number): string[] {
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
