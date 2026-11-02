// Card details: the fields of the kanban the card is in, one labelled control per field in schema
// order (the column field "Stage" first, by default). Every change is one `card.setValues` write
// (one undo step); text, number and link boxes write when they lose focus or on Enter.
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ExternalLink } from 'lucide-react';
import { COLUMN_FIELD_ID, cardValue, type CardElement, type FieldDef, type FieldOption, type FieldValue, type KanbanElement } from '@freero/shared';
import { isSafeHref, type Editor } from '@engine';
import { Select } from '@ui';
import { cardCollection, setValues } from './values';
import { useBoardPeople } from './people';

function Chip({ option }: { option: FieldOption }) {
  return (
    <span className="fr-card-fields__chip" style={{ ['--opt' as string]: option.color }}>
      <span className="fr-card-fields__dot" aria-hidden />
      {option.label || 'Untitled'}
    </span>
  );
}

/** A box that writes what was typed on blur / Enter, and shows the card's value otherwise. */
function CommitBox(props: { id: string; type: 'text' | 'number' | 'url'; value: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(props.value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(props.value);
  }, [props.value]);
  const commit = () => {
    if (draft.trim() !== props.value.trim()) props.onCommit(draft);
  };
  return (
    <input
      id={props.id}
      className="fr-card-fields__box"
      type={props.type}
      inputMode={props.type === 'number' ? 'decimal' : undefined}
      step={props.type === 'number' ? 'any' : undefined}
      value={draft}
      disabled={props.disabled}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
        setDraft(props.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') setDraft(props.value);
      }}
    />
  );
}

function PersonPicker({ editor, id, value, disabled, onChange }: { editor: Editor; id: string; value: string | null; disabled: boolean; onChange: (v: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const people = useBoardPeople(editor, open);
  const known = !value || people.some((p) => p.id === value);
  return (
    <span onFocus={() => setOpen(true)} onPointerDown={() => setOpen(true)}>
      <Select<string>
        id={id}
        size="sm"
        width="100%"
        disabled={disabled}
        value={value ?? ''}
        options={[
          { value: '', label: 'Nobody' },
          ...people.map((p) => ({ value: p.id, label: p.name })),
          ...(known ? [] : [{ value: value!, label: 'Someone who no longer has access' }]),
        ]}
        onChange={(v) => onChange(v || null)}
      />
    </span>
  );
}

function FieldControl({ editor, card, kanban, field }: { editor: Editor; card: CardElement; kanban: KanbanElement; field: FieldDef }) {
  const id = useId();
  const value = cardValue(kanban, card, field);
  const disabled = !!card.locked;
  const set = (v: FieldValue | null) => setValues(editor, card.id, { [field.id]: v });
  const str = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
  let control;
  switch (field.type) {
    case 'select':
      control = (
        <Select<string>
          id={id}
          size="sm"
          width="100%"
          disabled={disabled}
          value={str}
          options={[
            // The column field always has a value: the column the card is in.
            ...(field.id === COLUMN_FIELD_ID ? [] : [{ value: '', label: <span className="fr-card-fields__none">None</span> }]),
            ...(field.options ?? []).map((o) => ({ value: o.id, label: <Chip option={o} /> })),
          ]}
          onChange={(v) => set(v || null)}
        />
      );
      break;
    case 'multiselect': {
      const on = new Set(Array.isArray(value) ? value : []);
      control = (
        <div id={id} className="fr-card-fields__multi" role="group" aria-label={field.name}>
          {(field.options ?? []).map((o) => (
            <button
              key={o.id}
              type="button"
              className="fr-card-fields__toggle"
              aria-pressed={on.has(o.id)}
              disabled={disabled}
              onClick={() => set((field.options ?? []).filter((x) => (x.id === o.id ? !on.has(o.id) : on.has(x.id))).map((x) => x.id))}
            >
              <Chip option={o} />
            </button>
          ))}
          {!field.options?.length && <span className="fr-card-fields__none">No options yet</span>}
        </div>
      );
      break;
    }
    case 'person':
      control = <PersonPicker editor={editor} id={id} value={typeof value === 'string' ? value : null} disabled={disabled} onChange={set} />;
      break;
    case 'date':
      control = <input id={id} className="fr-card-fields__box" type="date" value={str} disabled={disabled} onChange={(e) => set(e.target.value || null)} />;
      break;
    case 'checkbox':
      control = <input id={id} className="fr-card-fields__check" type="checkbox" checked={value === true} disabled={disabled} onChange={(e) => set(e.target.checked || null)} />;
      break;
    case 'url':
      control = (
        <span className="fr-card-fields__url">
          <CommitBox id={id} type="url" value={str} disabled={disabled} onCommit={(v) => set(v.trim() || null)} />
          {str && isSafeHref(str) && (
            <a href={str} target="_blank" rel="noopener noreferrer nofollow" className="fr-card-fields__open" aria-label={`Open ${field.name}`}>
              <ExternalLink size={14} aria-hidden />
            </a>
          )}
        </span>
      );
      break;
    default:
      control = <CommitBox id={id} type={field.type === 'number' ? 'number' : 'text'} value={str} disabled={disabled} onCommit={(v) => set(v.trim() ? v : null)} />;
  }
  return (
    <>
      <label className="fr-card-fields__name" htmlFor={id}>
        {field.name}
      </label>
      <div className="fr-card-fields__value">{control}</div>
    </>
  );
}

/** The card's fields on its kanban; nothing for a card outside any kanban. */
export function CardFields({ editor, card }: { editor: Editor; card: CardElement }) {
  // Re-renders when the kanban's fields change, not only when the card does.
  const frameId = card.frameId ?? null;
  useSyncExternalStore(
    useCallback((cb) => editor.on('elements', cb), [editor]),
    () => (frameId ? editor.getElement(frameId) : undefined),
  );
  const coll = cardCollection(editor, card);
  if (!coll) return null;
  return (
    <div className="fr-card-fields">
      <div className="fr-card-pop__label">Fields</div>
      <div className="fr-card-fields__grid">
        {coll.schema.map((f) => (
          <FieldControl key={f.id} editor={editor} card={card} kanban={coll.kanban} field={f} />
        ))}
      </div>
    </div>
  );
}
