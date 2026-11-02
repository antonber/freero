// The Fields panel (dock): a kanban's fields — add, rename, reorder and delete them, and edit the
// options of select fields with their colours. The column field ("Stage") is the board's columns:
// its options are added, renamed, recoloured, reordered and deleted as columns. Shows the kanban
// the selection points at (the kanban, or the kanban a selected card is in), and keeps showing it
// when the selection moves elsewhere. Viewers and locked kanbans see the fields read-only.
import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ChevronDown,
  ChevronUp,
  CircleChevronDown,
  Hash,
  Link,
  ListChecks,
  MoreHorizontal,
  Plus,
  SquareCheck,
  Tags,
  Trash2,
  Type,
  User,
  type LucideIcon,
} from 'lucide-react';
import {
  COLUMN_FIELD_ID,
  FIELD_TYPES,
  groupFieldId,
  STATUS_OPTIONS,
  collectionSchema,
  type CardStatus,
  type FieldDef,
  type FieldOption,
  type FieldType,
  type KanbanElement,
} from '@freero/shared';
import { DockHeader, definePanel, richTextToPlain, useCanEdit, useElement, useSelection, type Editor } from '@engine';
import { Button, ColorSwatches, IconButton, Input, Menu, Popover, Select, type MenuItem } from '@ui';
import { COLUMN_COLOR_NAMES, COLUMN_PALETTE, FIELDS_PANEL, VIEW_PANEL } from './lib/constants';
import { ViewPanel } from './lib/ViewPanel';
import { addField, addOption, fieldsTarget, moveField, moveOption, patchOption, removeField, removeOption, renameField, FIELD_TYPE_LABELS } from './lib/schema';

const TYPE_ICONS: Record<FieldType, LucideIcon> = {
  select: CircleChevronDown,
  multiselect: Tags,
  person: User,
  date: Calendar,
  number: Hash,
  text: Type,
  url: Link,
  checkbox: SquareCheck,
};

/** A text box that writes on Enter / blur (one undo step per commit) and shows why a name was refused. */
function CommitInput(props: { value: string; label: string; disabled: boolean; onCommit: (v: string) => string | null | void; autoFocus?: boolean }) {
  const [draft, setDraft] = useState(props.value);
  const [error, setError] = useState<string | null>(null);
  const focused = useRef(false);
  // Someone else's rename (or undo) shows up unless this box is being typed in.
  useEffect(() => {
    if (!focused.current) setDraft(props.value);
  }, [props.value]);
  const commit = () => {
    if (draft === props.value) return setError(null);
    const problem = props.onCommit(draft);
    setError(problem || null);
  };
  return (
    <Input
      size="sm"
      className="fr-kanban-fields__input"
      value={draft}
      aria-label={props.label}
      disabled={props.disabled}
      autoFocus={props.autoFocus}
      error={error ?? undefined}
      onFocus={(e) => {
        focused.current = true;
        if (props.autoFocus) e.currentTarget.select();
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(props.value);
          setError(null);
        }
      }}
    />
  );
}

function RowMenu({ label, items }: { label: string; items: MenuItem[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <IconButton ref={ref} icon={MoreHorizontal} size={32} label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} />
      <Menu open={open} onClose={() => setOpen(false)} anchor={ref.current} items={items} aria-label={label} />
    </>
  );
}

function OptionColor({ option, disabled, onChange }: { option: FieldOption; disabled: boolean; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="fr-kanban-fields__swatch"
        style={{ background: option.color }}
        disabled={disabled}
        aria-label={`Colour of ${option.label || 'Untitled'}: ${COLUMN_COLOR_NAMES[option.color] ?? option.color}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="start" aria-label="Option colour">
        <ColorSwatches
          colors={COLUMN_PALETTE}
          names={COLUMN_COLOR_NAMES}
          value={option.color}
          columns={6}
          aria-label="Option colour"
          onChange={(c) => {
            onChange(c);
            setOpen(false);
          }}
        />
      </Popover>
    </>
  );
}

const STATUS_CHOICES: Array<{ value: CardStatus | ''; label: string }> = [
  ...STATUS_OPTIONS.map((o) => ({ value: o.id as CardStatus, label: `Sets ${o.label}` })),
  { value: '', label: 'Keeps status' },
];

function Options({ editor, k, field, canEdit }: { editor: Editor; k: KanbanElement; field: FieldDef; canEdit: boolean }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const options = field.options ?? [];
  const isColumn = field.id === groupFieldId(k);
  const noun = isColumn ? 'column' : 'option';
  return (
    <div className="fr-kanban-fields__options">
      {options.length ? (
        <ul className="fr-kanban-fields__option-list" aria-label={`Options of ${field.name}`}>
          {options.map((o, i) => (
            <li key={o.id} className="fr-kanban-fields__option">
              <OptionColor option={o} disabled={!canEdit} onChange={(color) => patchOption(editor, k.id, field.id, o.id, { color })} />
              <CommitInput
                value={o.label}
                label={`${isColumn ? 'Column' : 'Option'} name`}
                disabled={!canEdit}
                autoFocus={fresh === o.id}
                onCommit={(label) => patchOption(editor, k.id, field.id, o.id, { label: label.trim() })}
              />
              {isColumn && (
                <Select<CardStatus | ''>
                  size="sm"
                  variant="ghost"
                  aria-label={`Card status in ${o.label || 'Untitled'}`}
                  disabled={!canEdit}
                  value={o.status ?? ''}
                  options={STATUS_CHOICES}
                  onChange={(s) => patchOption(editor, k.id, field.id, o.id, { status: s || null })}
                />
              )}
              {canEdit && (
                <RowMenu
                  label={`${isColumn ? 'Column' : 'Option'} options: ${o.label || 'Untitled'}`}
                  items={[
                    { id: 'up', label: isColumn ? 'Move left' : 'Move up', icon: ChevronUp, disabled: i === 0, onSelect: () => moveOption(editor, k.id, field.id, o.id, -1) },
                    { id: 'down', label: isColumn ? 'Move right' : 'Move down', icon: ChevronDown, disabled: i === options.length - 1, onSelect: () => moveOption(editor, k.id, field.id, o.id, 1) },
                    { divider: true },
                    {
                      id: 'delete',
                      label: `Delete ${noun}`,
                      icon: Trash2,
                      danger: true,
                      disabled: isColumn && options.length < 2,
                      disabledReason: isColumn && options.length < 2 ? 'A kanban keeps at least one column' : undefined,
                      onSelect: () => removeOption(editor, k.id, field.id, o.id),
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-kanban-fields__hint">No options yet.</p>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setFresh(addOption(editor, k.id, field.id))}>
          {isColumn ? 'Add column' : 'Add option'}
        </Button>
      )}
    </div>
  );
}

function FieldRow(props: { editor: Editor; k: KanbanElement; field: FieldDef; index: number; count: number; canEdit: boolean; autoFocus: boolean }) {
  const { editor, k, field, index, count, canEdit } = props;
  const TypeIcon = TYPE_ICONS[field.type];
  const isColumn = field.id === groupFieldId(k);
  const undeletable = isColumn || field.id === COLUMN_FIELD_ID;
  return (
    <li className="fr-kanban-fields__field">
      <div className="fr-kanban-fields__row">
        <span className="fr-kanban-fields__type" title={FIELD_TYPE_LABELS[field.type]}>
          <TypeIcon size={16} aria-hidden />
        </span>
        <CommitInput value={field.name} label="Field name" disabled={!canEdit} autoFocus={props.autoFocus} onCommit={(name) => renameField(editor, k.id, field.id, name)} />
        <span className="fr-kanban-fields__type-name">{isColumn ? `${FIELD_TYPE_LABELS[field.type]} · columns` : FIELD_TYPE_LABELS[field.type]}</span>
        {canEdit && (
          <RowMenu
            label={`Field options: ${field.name}`}
            items={[
              { id: 'up', label: 'Move up', icon: ChevronUp, disabled: index === 0, onSelect: () => moveField(editor, k.id, field.id, -1) },
              { id: 'down', label: 'Move down', icon: ChevronDown, disabled: index === count - 1, onSelect: () => moveField(editor, k.id, field.id, 1) },
              { divider: true },
              {
                id: 'delete',
                label: 'Delete field',
                icon: Trash2,
                danger: true,
                disabled: undeletable,
                disabledReason: isColumn ? 'This field makes the columns' : undeletable ? 'Stage can be renamed, not deleted' : undefined,
                onSelect: () => removeField(editor, k.id, field.id),
              },
            ]}
          />
        )}
      </div>
      {isColumn && (
        <p className="fr-kanban-fields__hint">
          {field.type === 'select' ? 'Its options are the board’s columns: a card’s value is the column it is in.' : 'The board is grouped by it: a card’s value is the column it is in.'}
        </p>
      )}
      {field.options && <Options editor={editor} k={k} field={field} canEdit={canEdit} />}
    </li>
  );
}

function AddField({ editor, k, onAdded }: { editor: Editor; k: KanbanElement; onAdded: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={ref} size="sm" variant="secondary" icon={Plus} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Add field
      </Button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        aria-label="Field type"
        items={FIELD_TYPES.map((t) => ({ id: t, label: FIELD_TYPE_LABELS[t], icon: TYPE_ICONS[t], onSelect: () => onAdded(addField(editor, k.id, t)) }))}
      />
    </>
  );
}

function FieldsPanel({ editor }: { editor: Editor }) {
  const selection = useSelection();
  const canEdit = useCanEdit();
  const [kid, setKid] = useState<string | null>(() => fieldsTarget(editor)?.id ?? null);
  const [fresh, setFresh] = useState<string | null>(null);
  useEffect(() => {
    const t = fieldsTarget(editor);
    if (t) setKid(t.id);
  }, [editor, selection]);
  const found = useElement(kid);
  const k = found?.type === 'kanban' ? (found as KanbanElement) : null;
  const schema = k ? collectionSchema(k) : [];
  const editable = canEdit && !!k && !k.locked;
  return (
    <div className="fr-kanban-fields">
      <DockHeader className="fr-kanban-fields__head">
        <h2 className="fr-kanban-fields__title">Fields</h2>
        {k && <span className="fr-kanban-fields__of">{richTextToPlain(k.title) || 'Kanban'}</span>}
      </DockHeader>
      {!k ? (
        <div className="fr-kanban-fields__empty">
          <ListChecks size={28} strokeWidth={1.5} aria-hidden />
          <strong>Select a kanban board</strong>
          <span>Its fields show here: what every card on it can hold, like a priority, an owner or points.</span>
        </div>
      ) : (
        <>
          {k.locked && <p className="fr-kanban-fields__hint">This kanban is locked: unlock it to change its fields.</p>}
          <ol className="fr-kanban-fields__list" aria-label="Fields">
            {schema.map((f, i) => (
              <FieldRow key={f.id} editor={editor} k={k} field={f} index={i} count={schema.length} canEdit={editable} autoFocus={fresh === f.id} />
            ))}
          </ol>
          {editable && (
            <div className="fr-kanban-fields__foot">
              <AddField editor={editor} k={k} onAdded={setFresh} />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default [
  definePanel({
    id: FIELDS_PANEL,
    slot: 'dock-right',
    order: 60,
    minRole: 'viewer',
    Component: FieldsPanel,
  }),
  // Any role: viewers look at the board their own way too (personal view settings).
  definePanel({
    id: VIEW_PANEL,
    slot: 'dock-right',
    order: 61,
    minRole: 'viewer',
    Component: ViewPanel,
  }),
];
