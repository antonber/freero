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
import { COLUMN_COLOR_NAMES, COLUMN_PALETTE, FIELDS_PANEL, FOCUS_PANEL, VIEW_PANEL } from './lib/constants';
import { FocusDialog } from './lib/Focus';
import { ViewPanel } from './lib/ViewPanel';
import { addField, addOption, fieldsTarget, moveField, moveOption, patchOption, removeField, removeOption, renameField, FIELD_TYPE_LABELS } from './lib/schema';

import { t as tr } from './messages';
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
        aria-label={tr('colourOfValueValue2', { value: option.label || tr('untitled'), value2: COLUMN_COLOR_NAMES[option.color] ?? option.color })}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      />
      <Popover open={open} onClose={() => setOpen(false)} anchor={ref.current} side="bottom" align="start" aria-label={tr('optionColour')}>
        <ColorSwatches
          colors={COLUMN_PALETTE}
          names={COLUMN_COLOR_NAMES}
          value={option.color}
          columns={6}
          aria-label={tr('optionColour')}
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
  ...STATUS_OPTIONS.map((o) => ({ value: o.id as CardStatus, label: tr('setsLabel', { label: o.label }) })),
  { value: '', label: tr('keepsStatus') },
];

function Options({ editor, k, field, canEdit }: { editor: Editor; k: KanbanElement; field: FieldDef; canEdit: boolean }) {
  const [fresh, setFresh] = useState<string | null>(null);
  const options = field.options ?? [];
  const isColumn = field.id === groupFieldId(k);
  const noun = isColumn ? 'column' : 'option';
  return (
    <div className="fr-kanban-fields__options">
      {options.length ? (
        <ul className="fr-kanban-fields__option-list" aria-label={tr('optionsOfName', { name: field.name })}>
          {options.map((o, i) => (
            <li key={o.id} className="fr-kanban-fields__option">
              <OptionColor option={o} disabled={!canEdit} onChange={(color) => patchOption(editor, k.id, field.id, o.id, { color })} />
              <CommitInput
                value={o.label}
                label={tr('valueName', { value: isColumn ? tr('column') : tr('option') })}
                disabled={!canEdit}
                autoFocus={fresh === o.id}
                onCommit={(label) => patchOption(editor, k.id, field.id, o.id, { label: label.trim() })}
              />
              {isColumn && (
                <Select<CardStatus | ''>
                  size="sm"
                  variant="ghost"
                  aria-label={tr('cardStatusInValue', { value: o.label || tr('untitled') })}
                  disabled={!canEdit}
                  value={o.status ?? ''}
                  options={STATUS_CHOICES}
                  onChange={(s) => patchOption(editor, k.id, field.id, o.id, { status: s || null })}
                />
              )}
              {canEdit && (
                <RowMenu
                  label={tr('valueOptionsValue2', { value: isColumn ? tr('column') : tr('option'), value2: o.label || tr('untitled') })}
                  items={[
                    { id: 'up', label: isColumn ? tr('moveLeft') : tr('moveUp'), icon: ChevronUp, disabled: i === 0, onSelect: () => moveOption(editor, k.id, field.id, o.id, -1) },
                    { id: 'down', label: isColumn ? tr('moveRight') : tr('moveDown'), icon: ChevronDown, disabled: i === options.length - 1, onSelect: () => moveOption(editor, k.id, field.id, o.id, 1) },
                    { divider: true },
                    {
                      id: 'delete',
                      label: tr('deleteNoun', { noun }),
                      icon: Trash2,
                      danger: true,
                      disabled: isColumn && options.length < 2,
                      disabledReason: isColumn && options.length < 2 ? tr('aKanbanKeepsAtLeast') : undefined,
                      onSelect: () => removeOption(editor, k.id, field.id, o.id),
                    },
                  ]}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="fr-kanban-fields__hint">{tr('noOptionsYet')}</p>
      )}
      {canEdit && (
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setFresh(addOption(editor, k.id, field.id))}>
          {isColumn ? tr('addColumn') : tr('addOption')}
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
        <CommitInput value={field.name} label={tr('fieldName')} disabled={!canEdit} autoFocus={props.autoFocus} onCommit={(name) => renameField(editor, k.id, field.id, name)} />
        <span className="fr-kanban-fields__type-name">{isColumn ? tr('fieldTypeLabelsColumns', { field_type_labels: FIELD_TYPE_LABELS[field.type] }) : FIELD_TYPE_LABELS[field.type]}</span>
        {canEdit && (
          <RowMenu
            label={tr('fieldOptionsName', { name: field.name })}
            items={[
              { id: 'up', label: tr('moveUp'), icon: ChevronUp, disabled: index === 0, onSelect: () => moveField(editor, k.id, field.id, -1) },
              { id: 'down', label: tr('moveDown'), icon: ChevronDown, disabled: index === count - 1, onSelect: () => moveField(editor, k.id, field.id, 1) },
              { divider: true },
              {
                id: 'delete',
                label: tr('deleteField'),
                icon: Trash2,
                danger: true,
                disabled: undeletable,
                disabledReason: isColumn ? tr('thisFieldMakesTheColumns') : undeletable ? tr('stageCanBeRenamedNot') : undefined,
                onSelect: () => removeField(editor, k.id, field.id),
              },
            ]}
          />
        )}
      </div>
      {isColumn && (
        <p className="fr-kanban-fields__hint">
          {field.type === 'select' ? tr('itsOptionsAreTheBoard') : tr('theBoardIsGroupedBy')}
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
      <Button ref={ref} size="sm" variant="secondary" icon={Plus} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{tr('addField')}</Button>
      <Menu
        open={open}
        onClose={() => setOpen(false)}
        anchor={ref.current}
        aria-label={tr('fieldType')}
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
        <h2 className="fr-kanban-fields__title">{tr('fields')}</h2>
        {k && <span className="fr-kanban-fields__of">{richTextToPlain(k.title) || tr('kanban')}</span>}
      </DockHeader>
      {!k ? (
        <div className="fr-kanban-fields__empty">
          <ListChecks size={28} strokeWidth={1.5} aria-hidden />
          <strong>{tr('selectAKanbanBoard')}</strong>
          <span>{tr('itsFieldsShowHereWhat')}</span>
        </div>
      ) : (
        <>
          {k.locked && <p className="fr-kanban-fields__hint">{tr('thisKanbanIsLockedUnlock')}</p>}
          <ol className="fr-kanban-fields__list" aria-label={tr('fields')}>
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
  // Focus mode: any role (it changes nothing for anyone else; editors' cell edits are card writes).
  definePanel({
    id: FOCUS_PANEL,
    slot: 'dialog',
    order: 62,
    minRole: 'viewer',
    Component: FocusDialog,
  }),
];
