// Editing a kanban's fields (the Fields panel). Each edit is one write of the kanban (one undo
// step). The group field's options (the column field "Stage", or whichever single select the board
// is grouped by) are the columns, so its option edits are column edits (lib/actions.ts): adding
// one adds a column, deleting one hands its cards to the neighbour.
// Values on cards are never rewritten here: a deleted field's or option's values stay on the
// cards and read as nothing (undo brings them back).
import { nanoid } from 'nanoid';
import {
  COLUMN_FIELD_ID,
  FIELD_LIMITS,
  NO_GROUP,
  collectionSchema,
  groupFieldId,
  fieldNameProblem,
  plainToRichText,
  storedFields,
  type CardStatus,
  type FieldDef,
  type FieldOption,
  type FieldType,
  type KanbanElement,
} from '@freero/shared';
import type { Editor } from '@engine';
import { addColumn, moveColumnTo, patchColumn, removeColumn } from './actions';
import { COLUMN_PALETTE } from './constants';

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  select: 'Single select',
  multiselect: 'Multi-select',
  person: 'Person',
  date: 'Date',
  number: 'Number',
  text: 'Text',
  url: 'Link',
  checkbox: 'Checkbox',
};

const DEFAULT_NAMES: Record<FieldType, string> = {
  select: 'Priority',
  multiselect: 'Labels',
  person: 'Owner',
  date: 'Date',
  number: 'Points',
  text: 'Notes',
  url: 'URL',
  checkbox: 'Done?',
};

function editable(editor: Editor, id: string): KanbanElement | null {
  const k = editor.getElement<KanbanElement>(id);
  return k && k.type === 'kanban' && !k.locked ? k : null;
}

const write = (editor: Editor, id: string, schema: FieldDef[]) => {
  const k = editor.getElement<KanbanElement>(id);
  if (k) editor.update<KanbanElement>(id, { fields: storedFields(schema, groupFieldId(k)) });
};

/** True when field `fieldId`'s options are kanban `kid`'s columns (the field it is grouped by). */
const isGroup = (editor: Editor, kid: string, fieldId: string) => {
  const k = editor.getElement<KanbanElement>(kid);
  return !!k && groupFieldId(k) === fieldId;
};

/** `base`, or "base 2", "base 3"… whichever no field of `schema` has yet. */
function freeName(schema: FieldDef[], base: string): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!fieldNameProblem(schema, name)) return name;
  }
}

/** Adds a field at the end; returns its id (null when the kanban can't take another). */
export function addField(editor: Editor, kid: string, type: FieldType): string | null {
  const k = editable(editor, kid);
  if (!k) return null;
  const schema = collectionSchema(k);
  if (schema.length >= FIELD_LIMITS.fields) return null;
  const f: FieldDef = { id: nanoid(8), name: freeName(schema, DEFAULT_NAMES[type]), type, ...(type === 'select' || type === 'multiselect' ? { options: [] } : {}) };
  write(editor, kid, [...schema, f]);
  return f.id;
}

/** Renames a field; returns why it can't take that name (nothing changes then), or null. */
export function renameField(editor: Editor, kid: string, fieldId: string, name: string): string | null {
  const k = editable(editor, kid);
  if (!k) return null;
  const schema = collectionSchema(k);
  const f = schema.find((x) => x.id === fieldId);
  if (!f || f.name === name.trim()) return null;
  const problem = fieldNameProblem(schema, name, fieldId);
  if (problem) return problem;
  write(editor, kid, schema.map((x) => (x.id === fieldId ? { ...x, name: name.trim() } : x)));
  return null;
}

/** Moves a field one place up (-1) or down (+1) in the schema. */
export function moveField(editor: Editor, kid: string, fieldId: string, dir: -1 | 1) {
  const k = editable(editor, kid);
  if (!k) return;
  const schema = collectionSchema(k);
  const i = schema.findIndex((f) => f.id === fieldId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= schema.length) return;
  const next = [...schema];
  [next[i], next[j]] = [next[j], next[i]];
  write(editor, kid, next);
}

/** Deletes a field (not the column field "Stage", nor the field the columns are). Its values stay on the cards, dormant. */
export function removeField(editor: Editor, kid: string, fieldId: string) {
  const k = editable(editor, kid);
  if (!k || fieldId === COLUMN_FIELD_ID || fieldId === groupFieldId(k)) return;
  const schema = collectionSchema(k);
  if (!schema.some((f) => f.id === fieldId)) return;
  write(editor, kid, schema.filter((f) => f.id !== fieldId));
}

function patchField(editor: Editor, kid: string, fieldId: string, fn: (options: FieldOption[]) => FieldOption[] | null) {
  const k = editable(editor, kid);
  if (!k) return;
  const schema = collectionSchema(k);
  const f = schema.find((x) => x.id === fieldId);
  if (!f?.options) return;
  const options = fn(f.options);
  if (options) write(editor, kid, schema.map((x) => (x.id === fieldId ? { ...x, options } : x)));
}

/** Adds an option (the column field: a column); returns its id. */
export function addOption(editor: Editor, kid: string, fieldId: string): string | null {
  if (isGroup(editor, kid, fieldId)) return addColumn(editor, kid);
  let id: string | null = null;
  patchField(editor, kid, fieldId, (options) => {
    if (options.length >= FIELD_LIMITS.options) return null;
    id = nanoid(8);
    return [...options, { id, label: 'New option', color: COLUMN_PALETTE[options.length % COLUMN_PALETTE.length] }];
  });
  return id;
}

/** Renames, recolours or (column field only) re-maps an option's card status. */
export function patchOption(editor: Editor, kid: string, fieldId: string, optionId: string, patch: { label?: string; color?: string; status?: CardStatus | null }) {
  if (isGroup(editor, kid, fieldId)) {
    patchColumn(editor, kid, optionId, {
      ...(patch.label !== undefined ? { title: plainToRichText(patch.label.slice(0, FIELD_LIMITS.label)) } : {}),
      ...(patch.color !== undefined ? { color: patch.color } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
    });
    return;
  }
  patchField(editor, kid, fieldId, (options) => {
    const o = options.find((x) => x.id === optionId);
    if (!o) return null;
    const next = { ...o, ...(patch.label !== undefined ? { label: patch.label.slice(0, FIELD_LIMITS.label) } : {}), ...(patch.color !== undefined ? { color: patch.color } : {}) };
    return next.label === o.label && next.color === o.color ? null : options.map((x) => (x.id === optionId ? next : x));
  });
}

/** Moves an option one place up / left (-1) or down / right (+1). */
export function moveOption(editor: Editor, kid: string, fieldId: string, optionId: string, dir: -1 | 1) {
  if (isGroup(editor, kid, fieldId)) {
    const k = editable(editor, kid);
    const i = k ? k.columns.findIndex((c) => c.id === optionId) : -1;
    // The "No <field>" column stays first.
    if (i >= 0 && k!.columns[i + dir] && k!.columns[i + dir].id !== NO_GROUP) moveColumnTo(editor, kid, optionId, i + dir);
    return;
  }
  patchField(editor, kid, fieldId, (options) => {
    const i = options.findIndex((o) => o.id === optionId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= options.length) return null;
    const next = [...options];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
}

/** The kanban whose fields the selection points at: a selected kanban, or the kanban a selected card is in. */
export function fieldsTarget(editor: Pick<Editor, 'getSelection' | 'getElement'>): KanbanElement | null {
  const sel = editor.getSelection();
  if (sel.length !== 1) return null;
  const el = editor.getElement(sel[0]);
  const k = el?.type === 'kanban' ? el : el?.frameId ? editor.getElement(el.frameId) : undefined;
  return k?.type === 'kanban' ? k : null;
}

/** Deletes an option. A column's cards join the neighbouring column; elsewhere values read as empty. */
export function removeOption(editor: Editor, kid: string, fieldId: string, optionId: string) {
  if (isGroup(editor, kid, fieldId)) return removeColumn(editor, kid, optionId);
  patchField(editor, kid, fieldId, (options) => (options.some((o) => o.id === optionId) ? options.filter((o) => o.id !== optionId) : null));
}
