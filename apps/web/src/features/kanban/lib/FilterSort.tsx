// The View panel's filter and sort sections (step 2d). The filter is this person's own until an
// editor saves it for everyone: their own filter fades the cards it leaves out, the saved one
// hides them from everyone. The sort moves the real cards, so editors change it for everyone.
// Rules are edited as a draft: a rule without its value yet (just added) is kept here and applied
// once it has one.
import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import {
  NO_GROUP,
  VALUELESS_OPS,
  cardValue,
  isMember,
  queryField,
  queryFields,
  sameFilter,
  type BoardElement,
  type FieldDef,
  type FilterOp,
  type FilterRule,
  type KanbanElement,
  type QueryField,
  type QueryKind,
  type SortRule,
  type ViewFilter,
} from '@freero/shared';
import { useElements, usePeople, type Editor } from '@engine';
import { Button, IconButton, Input, SegmentedControl, Select } from '@ui';
import { setMyFilter, setSort } from './view';

/** The rules a person picks from, per kind of field (agents have a few more: anyOf / noneOf on any choice). */
const UI_OPS: Record<QueryKind, Array<{ value: FilterOp; label: string }>> = {
  text: [
    { value: 'contains', label: 'contains' },
    { value: 'notContains', label: 'doesn’t contain' },
    { value: 'is', label: 'is' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
  ],
  number: [
    { value: 'is', label: '=' },
    { value: 'gt', label: '>' },
    { value: 'lt', label: '<' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
  ],
  date: [
    { value: 'is', label: 'is' },
    { value: 'gt', label: 'is after' },
    { value: 'lt', label: 'is before' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
  ],
  option: [
    { value: 'is', label: 'is' },
    { value: 'isNot', label: 'is not' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
  ],
  options: [
    { value: 'anyOf', label: 'has' },
    { value: 'noneOf', label: 'doesn’t have' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
  ],
  person: [
    { value: 'isMe', label: 'is me' },
    { value: 'is', label: 'is' },
    { value: 'isNot', label: 'is not' },
    { value: 'empty', label: 'is empty' },
    { value: 'notEmpty', label: 'is not empty' },
  ],
  checkbox: [
    { value: 'checked', label: 'is checked' },
    { value: 'unchecked', label: 'is not checked' },
  ],
};

/** Fields a person filters by here ($tags' choices are the board's tag list: agents filter by tag ids). */
const filterable = (schema: readonly FieldDef[]) => queryFields(schema).filter((f) => f.id !== '$tags' && f.id !== '$link');

const complete = (r: FilterRule) => VALUELESS_OPS.has(r.op) || (Array.isArray(r.value) ? r.value.length > 0 : r.value !== undefined && String(r.value).trim() !== '');

/** Text, a number or a date: kept as typed until Enter or leaving the box. */
function ValueInput({ kind, value, label, onCommit }: { kind: QueryKind; value: string; label: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <Input
      size="sm"
      aria-label={label}
      type={kind === 'date' ? 'date' : kind === 'number' ? 'number' : 'text'}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text !== value && onCommit(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onCommit(text);
      }}
    />
  );
}

/** People who own a card on this kanban by field `f`: who a person filter picks from. */
function usePeopleOn(k: KanbanElement, f: QueryField | null, all: BoardElement[], schema: readonly FieldDef[]) {
  const ids = useMemo(() => {
    if (f?.kind !== 'person') return [];
    const out = new Set<string>();
    for (const el of all) {
      if (!isMember(k, el)) continue;
      const v = f.id === '$assignee' ? el.assigneeId : cardValue(k, el, schema.find((x) => x.id === f.id)!);
      if (typeof v === 'string' && v && v !== NO_GROUP) out.add(v);
    }
    return [...out];
  }, [k, f, all, schema]);
  return { ids, people: usePeople(ids) };
}

function RuleRow({ k, schema, rule, onChange, onRemove }: { k: KanbanElement; schema: readonly FieldDef[]; rule: FilterRule; onChange: (r: FilterRule) => void; onRemove: () => void }) {
  const all = useElements();
  const fields = filterable(schema);
  const f = queryField(schema, rule.field);
  const { ids, people } = usePeopleOn(k, f, all, schema);
  const ops = f ? UI_OPS[f.kind] : [];
  const single = Array.isArray(rule.value) ? rule.value[0] : rule.value;
  const name = f?.name ?? 'Field';
  let value: JSX.Element | null = null;
  if (f && !VALUELESS_OPS.has(rule.op)) {
    if (f.kind === 'option' || f.kind === 'options') {
      const opts = (f.options ?? []).map((o) => ({ value: o.id, label: o.label || 'Untitled' }));
      value = (
        <Select
          size="sm"
          aria-label={`${name}: value`}
          placeholder="Choose…"
          value={typeof single === 'string' ? single : ''}
          options={opts}
          onChange={(id) => onChange({ ...rule, value: f.kind === 'options' ? [id] : id })}
        />
      );
    } else if (f.kind === 'person') {
      value = (
        <Select
          size="sm"
          aria-label={`${name}: person`}
          placeholder={ids.length ? 'Choose…' : 'Nobody yet'}
          disabled={!ids.length}
          value={typeof single === 'string' ? single : ''}
          options={ids.map((id) => ({ value: id, label: people[id]?.name ?? 'Someone' }))}
          onChange={(id) => onChange({ ...rule, value: id })}
        />
      );
    } else {
      value = <ValueInput kind={f.kind} label={`${name}: value`} value={single === undefined ? '' : String(single)} onCommit={(v) => onChange({ ...rule, value: f.kind === 'number' && v.trim() ? Number(v) : v })} />;
    }
  }
  return (
    <li className="fr-kanban-view__rule">
      <span className="fr-kanban-view__rule-line">
        <Select
          size="sm"
          aria-label="Filter by field"
          value={rule.field}
          options={fields.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(field) => {
            const nf = queryField(schema, field);
            onChange({ field, op: nf ? UI_OPS[nf.kind][0].value : 'notEmpty' });
          }}
        />
        <Select size="sm" aria-label={`${name}: rule`} value={rule.op} options={ops} onChange={(op) => onChange({ field: rule.field, op, ...(VALUELESS_OPS.has(op) ? {} : rule.value !== undefined && op !== 'anyOf' && op !== 'noneOf' ? { value: rule.value } : {}) })} />
        <IconButton icon={X} size={32} label={`Remove the ${name} rule`} onClick={onRemove} />
      </span>
      {value && <span className="fr-kanban-view__rule-value">{value}</span>}
    </li>
  );
}

/** "Filter": my own filter on top of what is saved (fades for me), saved for everyone with the rest of my view. */
export function FilterSection({ editor, k, schema, mine, saved, mayShare }: { editor: Editor; k: KanbanElement; schema: readonly FieldDef[]; mine: ViewFilter | null; saved: ViewFilter | null; mayShare: boolean }) {
  const [draft, setDraft] = useState<FilterRule[]>(mine?.rules ?? []);
  const [op, setOp] = useState<'and' | 'or'>(mine?.op ?? 'and');
  // Someone (me elsewhere, Save, Reset) changed my filter: start from it again.
  useEffect(() => {
    if (!sameFilter({ op, rules: draft.filter(complete) }, mine && { op: mine.op, rules: mine.rules })) {
      setDraft(mine?.rules ?? []);
      setOp(mine?.op ?? 'and');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine]);
  const commit = (rules: FilterRule[], nextOp = op) => {
    setDraft(rules);
    setOp(nextOp);
    const done = rules.filter(complete);
    setMyFilter(editor, k.id, done.length ? { op: nextOp, rules: done } : null);
  };
  const own = !sameFilter(mine, saved);
  const first = filterable(schema)[0];
  return (
    <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-filter">
      <h3 id="fr-kanban-view-filter" className="fr-kanban-view__heading">
        Filter
      </h3>
      {draft.length > 1 && (
        <label className="fr-kanban-view__row">
          <span>Cards that match</span>
          <SegmentedControl
            size="sm"
            aria-label="Cards that match"
            value={op}
            options={[
              { value: 'and', label: 'All rules' },
              { value: 'or', label: 'Any rule' },
            ]}
            onChange={(v) => commit(draft, v)}
          />
        </label>
      )}
      {draft.length > 0 && (
        <ol className="fr-kanban-fields__list fr-kanban-view__rules" aria-label="Filter rules">
          {draft.map((r, i) => (
            <RuleRow
              key={i}
              k={k}
              schema={schema}
              rule={r}
              onChange={(next) => commit(draft.map((x, j) => (j === i ? next : x)))}
              onRemove={() => commit(draft.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}
      {first && (
        <Button size="sm" variant="ghost" icon={Plus} onClick={() => setDraft([...draft, { field: first.id, op: UI_OPS[first.kind][0].value }])}>
          Add a rule
        </Button>
      )}
      <p className="fr-kanban-fields__hint">
        {own
          ? `Your filter fades the cards it leaves out, for you only.${saved ? ' Cards the saved filter hides stay hidden.' : ''}${mayShare ? ' Save for everyone to hide them on the board.' : ''}`
          : saved
            ? 'The saved filter hides cards it leaves out from everyone; they still count toward WIP limits.'
            : 'A filter you set here fades the other cards for you only, until it is saved for everyone.'}
      </p>
    </section>
  );
}

/** "Sort": every column in a field's order, for everyone (editors); none = the order people stacked the cards in. */
export function SortSection({ editor, k, schema, sort, mayShare }: { editor: Editor; k: KanbanElement; schema: readonly FieldDef[]; sort: readonly SortRule[]; mayShare: boolean }) {
  const fields = queryFields(schema).filter((f) => f.sortable && f.id !== '$link');
  const name = (id: string) => queryField(schema, id)?.name ?? id;
  const set = (next: SortRule[]) => setSort(editor, k.id, next);
  return (
    <section className="fr-kanban-view__section" aria-labelledby="fr-kanban-view-sort">
      <h3 id="fr-kanban-view-sort" className="fr-kanban-view__heading">
        Sort
      </h3>
      {!mayShare ? (
        <p className="fr-kanban-view__value">{sort.length ? `By ${sort.map((s) => `${name(s.field)}${s.dir === 'desc' ? ' (descending)' : ''}`).join(', then ')}` : 'Manual order'}</p>
      ) : (
        <>
          {sort.length > 0 && (
            <ol className="fr-kanban-fields__list fr-kanban-view__rules" aria-label="Sort order">
              {sort.map((s, i) => (
                <li key={s.field} className="fr-kanban-view__rule">
                  <span className="fr-kanban-view__rule-line">
                    <Select
                      size="sm"
                      aria-label={i ? 'Then by' : 'Sort by'}
                      value={s.field}
                      options={fields.filter((f) => f.id === s.field || !sort.some((x) => x.field === f.id)).map((f) => ({ value: f.id, label: f.name }))}
                      onChange={(field) => set(sort.map((x, j) => (j === i ? { ...x, field } : x)))}
                    />
                    <SegmentedControl
                      size="sm"
                      aria-label={`${name(s.field)}: direction`}
                      value={s.dir}
                      options={[
                        { value: 'asc', label: 'Ascending' },
                        { value: 'desc', label: 'Descending' },
                      ]}
                      onChange={(dir) => set(sort.map((x, j) => (j === i ? { ...x, dir } : x)))}
                    />
                    <IconButton icon={X} size={32} label={`Stop sorting by ${name(s.field)}`} onClick={() => set(sort.filter((_, j) => j !== i))} />
                  </span>
                </li>
              ))}
            </ol>
          )}
          <span className="fr-kanban-view__whose-actions">
            {sort.length < 3 && fields.some((f) => !sort.some((s) => s.field === f.id)) && (
              <Button size="sm" variant="ghost" icon={Plus} onClick={() => set([...sort, { field: fields.find((f) => !sort.some((s) => s.field === f.id))!.id, dir: 'asc' }])}>
                {sort.length ? 'Then by' : 'Sort cards'}
              </Button>
            )}
            {sort.length > 0 && (
              <Button size="sm" variant="ghost" onClick={() => set([])}>
                Back to manual order
              </Button>
            )}
          </span>
          <p className="fr-kanban-fields__hint">
            {sort.length
              ? 'Sorting moves the cards for everyone. Cards still move between columns; back to manual order puts every card where it was.'
              : 'Cards are in the order people put them. Sorting moves them for everyone.'}
          </p>
        </>
      )}
    </section>
  );
}
