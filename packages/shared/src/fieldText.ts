// Kanban fields from the outside world (docs/design/kanban-fields-and-views.md, step 2f): a
// spreadsheet's or a tracker's words read as a field's values, values written back out as words
// (CSV), what type a column of words is, and the options a set of labels needs. Pure: the CSV
// import / export, the templates and the tracker sync all read and write field text through here,
// so "High" means the same option everywhere and a date reads the same way in each of them.
import { canonicalValue, optionByLabel, type FieldDef, type FieldOption, type FieldType, type FieldValue } from './fields';
import { isISODate } from './layout/timeline';

/** Colours new options get, in turn (the Freero column palette, ui/tokens.css family). */
export const OPTION_COLORS: readonly string[] = ['#8A89A3', '#2E9BF0', '#14B8A6', '#1FA463', '#84CC16', '#F5A524', '#F97316', '#E5484D', '#E64DA6', '#8B5CF6', '#5B3FF0'];

/** Colours for ranked options, most pressing first (priority, severity): red → orange → amber → blue → gray. */
const RANKED = ['#E5484D', '#F97316', '#F5A524', '#2E9BF0', '#8A89A3'];
export function rankColor(i: number, n: number): string {
  if (n <= 1) return RANKED[0];
  return RANKED[Math.round((i * (RANKED.length - 1)) / (n - 1))] ?? RANKED[RANKED.length - 1];
}

/** How labels are compared when they come from outside: case and runs of spaces don't count. */
export const labelKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** The name of the field a tracker's priority goes to (a single select). */
export const PRIORITY_FIELD_NAME = 'Priority';

/** The kanban's priority field: the single select called "Priority" (any case), if it has one. */
export const priorityFieldOf = (schema: readonly FieldDef[]): FieldDef | undefined =>
  schema.find((f) => f.type === 'select' && labelKey(f.name) === labelKey(PRIORITY_FIELD_NAME));

// ------------------------------------------------------------------ words → values

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * YYYY-MM-DD from what a spreadsheet or a tracker writes: an ISO date (or date-time), or
 * day/month/year — read day-first unless the first number can only be a month (12/31/2026).
 */
export function parseDateText(text: string): string | null {
  const s = text.trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:$|[T ])/.exec(s);
  let out: string | null = null;
  if (iso) out = `${iso[1]}-${pad(Number(iso[2]))}-${pad(Number(iso[3]))}`;
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (dmy) {
    const [a, b, y] = [Number(dmy[1]), Number(dmy[2]), dmy[3]];
    const [d, m] = a > 12 ? [a, b] : b > 12 ? [b, a] : [a, b];
    out = `${y}-${pad(m)}-${pad(d)}`;
  }
  return out && isISODate(out) && Number(out.slice(0, 4)) >= 1900 ? out : null;
}

/** A number from "1,234.5", " 7 ", "-0.5"; null when it isn't one. */
export function parseNumberText(text: string): number | null {
  const t = text.trim().replace(/[\s,](?=\d{3}\b)/g, '');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const TRUE_WORDS = new Set(['true', 'yes', 'y', 'x', '✓', '✔', 'checked']);
const FALSE_WORDS = new Set(['false', 'no', 'n', 'unchecked']);

/** A checkbox from TRUE / FALSE, yes / no, x, ✓; null when the words are something else. */
export function parseCheckboxText(text: string): boolean | null {
  const t = text.trim().toLowerCase();
  return TRUE_WORDS.has(t) ? true : FALSE_WORDS.has(t) || t === '' ? false : null;
}

const isUrlText = (s: string) => /^(https?:\/\/|mailto:)\S+$/i.test(s.trim());

/** A multi-select cell's labels ("ux; mobile", "ux, mobile"). */
export const splitLabels = (text: string): string[] =>
  text
    .split(/[;|]|,(?!\d{3}\b)/)
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * The field type a column of words reads as, from every non-empty cell: checkbox (yes / no, TRUE /
 * FALSE), number, date, link, single select when few distinct short labels repeat (Priority, Team),
 * multi-select when cells list such labels ("ux; mobile"), else text. Person columns are never
 * guessed: names only become people where they are matched to members on purpose.
 */
export function inferFieldType(values: readonly string[]): FieldType {
  const vals = values.map((v) => v.trim()).filter(Boolean);
  if (!vals.length) return 'text';
  if (vals.every((v) => parseCheckboxText(v) !== null) && vals.some((v) => TRUE_WORDS.has(v.toLowerCase()))) return 'checkbox';
  if (vals.every((v) => parseNumberText(v) !== null)) return 'number';
  if (vals.every((v) => parseDateText(v) !== null)) return 'date';
  if (vals.every(isUrlText)) return 'url';
  const short = (l: string) => l.length <= 40 && l.split(/\s+/).length <= 5;
  const few = (labels: string[]) => {
    const distinct = new Set(labels.map(labelKey)).size;
    return labels.every(short) && distinct <= Math.min(12, Math.max(2, Math.floor(labels.length * 0.6)));
  };
  if (vals.some((v) => /;/.test(v))) {
    const parts = vals.flatMap(splitLabels);
    if (few(parts)) return 'multiselect';
  } else if (few(vals)) return 'select';
  return 'text';
}

/**
 * `options` with an option added for each of `labels` it doesn't have yet (case-insensitive), in
 * the order they come, coloured in turn (or by `colorOf`).
 */
export function withOptions(options: readonly FieldOption[], labels: readonly string[], newId: () => string, colorOf?: (label: string, i: number) => string): FieldOption[] {
  const out = [...options];
  const have = new Set(out.map((o) => labelKey(o.label)));
  for (const raw of labels) {
    const label = raw.trim().slice(0, 100);
    if (!label || have.has(labelKey(label))) continue;
    have.add(labelKey(label));
    out.push({ id: newId(), label, color: colorOf?.(label, out.length) ?? OPTION_COLORS[out.length % OPTION_COLORS.length] });
  }
  return out;
}

/**
 * Words as field `f` stores them: the canonical value, null for empty, undefined when they don't
 * fit (an option the field doesn't have, a person who isn't a member, an unreadable date).
 * `personId`: a member's id by name or email (the caller matches people; never guessed here).
 */
export function fieldValueFromText(f: FieldDef, text: string, ctx: { personId?(nameOrEmail: string): string | undefined } = {}): FieldValue | null | undefined {
  const t = text.trim();
  if (!t) return null;
  switch (f.type) {
    case 'select':
      return optionByLabel(f, t)?.id;
    case 'multiselect': {
      const ids = splitLabels(t).map((l) => optionByLabel(f, l)?.id);
      return ids.some((id) => !id) ? undefined : canonicalValue(f, ids);
    }
    case 'person':
      return ctx.personId?.(t);
    case 'date':
      return parseDateText(t) ?? undefined;
    case 'number':
      return parseNumberText(t) ?? undefined;
    case 'checkbox': {
      const b = parseCheckboxText(t);
      return b === null ? undefined : b ? true : null;
    }
    default:
      return canonicalValue(f, t);
  }
}

/**
 * A value as a spreadsheet cell: option labels (several joined by "; "), a person's name, ISO
 * dates, numbers as they are, checkboxes TRUE / FALSE (a field the card's kanban has, unchecked,
 * is FALSE), '' for empty.
 */
export function fieldValueToText(f: Pick<FieldDef, 'type' | 'options'>, v: FieldValue | null, personName?: (id: string) => string | undefined): string {
  if (f.type === 'checkbox') return v === true ? 'TRUE' : 'FALSE';
  if (v === null || v === undefined) return '';
  const label = (id: string) => f.options?.find((o) => o.id === id)?.label ?? '';
  switch (f.type) {
    case 'select':
      return typeof v === 'string' ? label(v) : '';
    case 'multiselect':
      return Array.isArray(v) ? v.map(label).filter(Boolean).join('; ') : '';
    case 'person':
      return typeof v === 'string' ? (personName?.(v) ?? '') : '';
    default:
      return String(v);
  }
}
